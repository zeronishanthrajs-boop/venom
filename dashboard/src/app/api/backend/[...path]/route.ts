import { NextRequest, NextResponse } from "next/server";

import {
  getAuthRequestContext,
  refreshAuthTokens,
  verifyAuthToken
} from "@/lib/auth";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_NAME
} from "@/lib/authConstants";
import { joinBackendUrl, normalizeBackendBaseUrl } from "@/lib/backendUrl";

export const runtime = "nodejs";
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60000;
const LONG_RUNNING_TIMEOUT_MS = 120000;
const ORCHESTRATION_TIMEOUT_MS = 300000;
const REPORT_PDF_TIMEOUT_MS = 90000;
const REPORT_EMAIL_TIMEOUT_MS = 60000;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function sanitizeHeaderValue(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (/[^\x20-\x7E]/.test(normalized)) {
    return null;
  }
  return normalized;
}

function getBackendBaseUrl() {
  const configured =
    process.env.VENOM_BACKEND_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_VENOM_API_BASE_URL?.trim();

  if (configured) {
    return normalizeBackendBaseUrl(configured);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "VENOM_BACKEND_BASE_URL is required in production for backend bridge routing."
    );
  }

  return normalizeBackendBaseUrl("http://localhost:5000");
}

function getBackendApiKey() {
  return (
    process.env.VENOM_BACKEND_API_KEY?.trim() ||
    process.env.VENOM_API_KEY?.trim() ||
    ""
  );
}

function getUpstreamTimeoutMs(pathSegments: string[]) {
  const joinedPath = `/${pathSegments.join("/")}`.toLowerCase();

  if (/^\/api\/reports\/[^/]+\/pdf$/.test(joinedPath)) {
    return REPORT_PDF_TIMEOUT_MS;
  }

  if (/^\/api\/reports\/[^/]+\/email$/.test(joinedPath)) {
    return REPORT_EMAIL_TIMEOUT_MS;
  }

  if (joinedPath.startsWith("/api/orchestrate")) {
    return ORCHESTRATION_TIMEOUT_MS;
  }

  if (
    joinedPath.startsWith("/api/chain/") ||
    joinedPath.startsWith("/api/prompts/evolve") ||
    joinedPath.startsWith("/api/cves/sync")
  ) {
    return LONG_RUNNING_TIMEOUT_MS;
  }

  return DEFAULT_UPSTREAM_TIMEOUT_MS;
}

async function proxyRequest(request: NextRequest, context: RouteContext) {
  const accessToken = request.cookies.get(AUTH_COOKIE_NAME)?.value || null;
  const requestContext = getAuthRequestContext(request.headers);
  let session = await verifyAuthToken(accessToken, requestContext);
  let refreshed: Awaited<ReturnType<typeof refreshAuthTokens>> = null;
  if (!session) {
    const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value || null;
    refreshed = await refreshAuthTokens(refreshToken, requestContext);
    session = refreshed?.session || null;
  }

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendApiKey = getBackendApiKey();
  if (!backendApiKey) {
    return NextResponse.json(
      {
        error:
          "Dashboard backend bridge is misconfigured. Set VENOM_BACKEND_API_KEY (or VENOM_API_KEY) in dashboard environment."
      },
      { status: 500 }
    );
  }

  const { path } = await context.params;
  const timeoutMs = getUpstreamTimeoutMs(path || []);
  const upstreamPath = path?.length ? `/${path.join("/")}` : "";
  const query = new URL(request.url).search;
  const upstreamUrl = joinBackendUrl(getBackendBaseUrl(), upstreamPath, query);

  const outboundHeaders = new Headers();
  outboundHeaders.set("x-api-key", backendApiKey);

  const incomingContentType = sanitizeHeaderValue(request.headers.get("content-type"));
  if (incomingContentType) {
    outboundHeaders.set("content-type", incomingContentType);
  }

  const safeUserId = sanitizeHeaderValue(session.email);
  const safeUserRole = sanitizeHeaderValue(session.role);
  if (!safeUserId || !safeUserRole) {
    return NextResponse.json(
      {
        errorType: "INVALID_HEADER_VALUE",
        message: "Invalid header value detected in proxy session data."
      },
      { status: 500 }
    );
  }

  outboundHeaders.set("x-user-id", safeUserId);
  outboundHeaders.set("x-user-role", safeUserRole);

  const method = request.method.toUpperCase();
  const bodyAllowed = !["GET", "HEAD"].includes(method);
  const rawBody = bodyAllowed ? await request.text() : "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let upstreamResponse: Response | null = null;
  const maxRetries = 3;
  const backoffDelays = [2000, 4000, 8000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method,
        headers: outboundHeaders,
        body: bodyAllowed && rawBody ? rawBody : undefined,
        cache: "no-store",
        signal: controller.signal
      });

      if (upstreamResponse.status !== 502) {
        break; 
      }
      
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelays[attempt]));
      } else {
        clearTimeout(timeout);
        return NextResponse.json(
          {
            errorType: "COLD_START",
            message: "Backend is starting up. Retrying automatically..."
          },
          { status: 503 }
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        clearTimeout(timeout);
        return NextResponse.json(
          {
            errorType: "SLOW_RESPONSE",
            message: "This report is taking longer than expected to load. Retrying..."
          },
          { status: 504 }
        );
      }

      const isConnectionRefused = error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed"));
      
      if (isConnectionRefused && attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelays[attempt]));
        continue;
      }
      
      clearTimeout(timeout);
      
      if (isConnectionRefused && attempt >= maxRetries) {
        return NextResponse.json(
          {
            errorType: "COLD_START",
            message: "Backend is starting up. Please wait 30 seconds."
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          errorType: "UNKNOWN",
          message: "Something went wrong. Please refresh and try again."
        },
        { status: 502 }
      );
    }
  }

  clearTimeout(timeout);
  if (!upstreamResponse) {
     return NextResponse.json({ errorType: "UNKNOWN", message: "Failed to fetch from upstream" }, { status: 502 });
  }

  // Handle downstream classifications based on upstream status
  const is503 = upstreamResponse.status === 503;
  const is504 = upstreamResponse.status === 504;
  const is500 = upstreamResponse.status === 500;
  
  if (is503) {
    return NextResponse.json({ errorType: "OVERLOADED", message: "Backend is busy. Please wait a moment." }, { status: 503 });
  }

  if (is504) {
    return NextResponse.json({ errorType: "SLOW_RESPONSE", message: "This report is taking longer than expected to load. Retrying..." }, { status: 504 });
  }

  if (is500) {
    const payloadText = await upstreamResponse.text().catch(() => "");
    const contentType = upstreamResponse.headers.get("content-type") || "";
    if (payloadText.includes("timed out")) {
      return NextResponse.json(
        { errorType: "GENERATION_TIMEOUT", message: "Report generation timed out. Please try again." },
        { status: 500 }
      );
    }

    if (contentType.includes("application/json")) {
      return new NextResponse(payloadText, {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }

    const safeErrorContentType = sanitizeHeaderValue(contentType) || "text/plain";
    return new NextResponse(payloadText, {
      status: 500,
      headers: { "content-type": safeErrorContentType }
    });

  }

  const payload = await upstreamResponse.arrayBuffer();
  const responseHeaders = new Headers();
  const contentType = sanitizeHeaderValue(upstreamResponse.headers.get("content-type"));
  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }

  const response = new NextResponse(payload, {
    status: upstreamResponse.status,
    headers: responseHeaders
  });
  if (refreshed) {
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: refreshed.accessToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
    });
    response.cookies.set({
      name: REFRESH_COOKIE_NAME,
      value: refreshed.refreshToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS
    });
  }
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyRequest(request, context);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

