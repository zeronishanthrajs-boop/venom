import { NextResponse } from "next/server";

import { joinBackendUrl, normalizeBackendBaseUrl } from "@/lib/backendUrl";

export const runtime = "nodejs";

function getBackendBaseUrl() {
  return normalizeBackendBaseUrl(
    process.env.VENOM_BACKEND_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_VENOM_API_BASE_URL?.trim() ||
      "http://localhost:5000"
  );
}

export async function GET() {
  const backendBaseUrl = getBackendBaseUrl();
  const upstreamUrl = joinBackendUrl(backendBaseUrl, "/ready");

  try {
    const response = await fetch(upstreamUrl, {
      method: "GET",
      cache: "no-store"
    });

    const payload = await response.json().catch(() => ({}));
    const ready = response.ok && payload?.status === "ready";

    return NextResponse.json(
      {
        ready,
        upstreamStatus: response.status,
        backend: payload,
        source: backendBaseUrl,
        timestamp: new Date().toISOString()
      },
      { status: ready ? 200 : 503 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ready-check error";

    return NextResponse.json(
      {
        ready: false,
        upstreamStatus: 0,
        error: message,
        source: backendBaseUrl,
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    );
  }
}
