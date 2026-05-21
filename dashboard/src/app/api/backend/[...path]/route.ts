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

export const runtime = "nodejs";
const DEFAULT_UPSTREAM_TIMEOUT_MS = 60000;
const LONG_RUNNING_TIMEOUT_MS = 120000;
const ORCHESTRATION_TIMEOUT_MS = 300000;
const REPORT_PDF_TIMEOUT_MS = 90000;
const REPORT_EMAIL_TIMEOUT_MS = 60000;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function getBackendBaseUrl() {
  const configured =
    process.env.VENOM_BACKEND_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_VENOM_API_BASE_URL?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "VENOM_BACKEND_BASE_URL is required in production for backend bridge routing."
    );
  }

  return "http://localhost:5000";
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
  const upstreamUrl = `${getBackendBaseUrl()}${upstreamPath}${query}`;

  const outboundHeaders = new Headers();
  outboundHeaders.set("x-api-key", backendApiKey);
  outboundHeaders.set("x-user-id", session.email);
  outboundHeaders.set("x-user-role", session.role);

  const incomingContentType = request.headers.get("content-type");
  if (incomingContentType) {
    outboundHeaders.set("content-type", incomingContentType);
  }

  const method = request.method.toUpperCase();
  const bodyAllowed = !["GET", "HEAD"].includes(method);
  const rawBody = bodyAllowed ? await request.text() : "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let upstreamResponse: Response;

  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: outboundHeaders,
      body: bodyAllowed && rawBody ? rawBody : undefined,
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json(
        {
          error: `Upstream timeout after ${timeoutMs}ms`
        },
        { status: 504 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Unknown upstream fetch error";
    return NextResponse.json(
      {
        error: `Upstream fetch failed: ${message}`
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = await upstreamResponse.arrayBuffer();
  const responseHeaders = new Headers();
  const contentType = upstreamResponse.headers.get("content-type");
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
