import { NextRequest, NextResponse } from "next/server";

import { verifyAuthToken } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/authConstants";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function getBackendBaseUrl() {
  return (
    process.env.VENOM_BACKEND_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_VENOM_API_BASE_URL?.trim() ||
    "http://localhost:5000"
  );
}

function getBackendApiKey() {
  return (
    process.env.VENOM_BACKEND_API_KEY?.trim() ||
    process.env.VENOM_API_KEY?.trim() ||
    ""
  );
}

async function proxyRequest(request: NextRequest, context: RouteContext) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value || null;
  const session = verifyAuthToken(token);

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

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers: outboundHeaders,
    body: bodyAllowed && rawBody ? rawBody : undefined,
    cache: "no-store"
  });

  const payload = await upstreamResponse.arrayBuffer();
  const responseHeaders = new Headers();
  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }

  return new NextResponse(payload, {
    status: upstreamResponse.status,
    headers: responseHeaders
  });
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
