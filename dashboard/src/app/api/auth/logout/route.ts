import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyAuthToken } from "@/lib/auth";
import { revokeAuthToken } from "@/lib/authRevocation";
import { AUTH_COOKIE_NAME } from "@/lib/authConstants";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value || null;
  const session = verifyAuthToken(token);
  revokeAuthToken(token, session?.expiresAt || null);

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

  return response;
}
