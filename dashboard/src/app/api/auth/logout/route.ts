import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { revokeAuthTokens } from "@/lib/auth";
import { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME } from "@/lib/authConstants";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(AUTH_COOKIE_NAME)?.value || null;
  const refreshToken = cookieStore.get(REFRESH_COOKIE_NAME)?.value || null;
  await Promise.all([
    revokeAuthTokens(accessToken, "logout"),
    revokeAuthTokens(refreshToken, "logout")
  ]);

  const response = NextResponse.json({ ok: true });
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
