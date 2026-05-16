import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  getAuthRequestContext,
  refreshAuthTokens
} from "@/lib/auth";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_NAME
} from "@/lib/authConstants";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE_NAME)?.value || null;
  const context = getAuthRequestContext(new Headers(request.headers));
  const refreshed = await refreshAuthTokens(refreshToken, context);
  if (!refreshed) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(0)
    });
    response.cookies.set({
      name: REFRESH_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: new Date(0)
    });
    return response;
  }

  const response = NextResponse.json({
    ok: true,
    session: refreshed.session
  });
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
  return response;
}

