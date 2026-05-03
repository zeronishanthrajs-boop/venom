import { NextResponse } from "next/server";

import {
  createAuthToken,
  normalizeEmail,
  safeCredentialCompare,
  verifyAuthToken
} from "@/lib/auth";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME
} from "@/lib/authConstants";

export const runtime = "nodejs";

type LoginPayload = {
  email?: string;
  password?: string;
};

function getConfiguredCredentials() {
  const email = process.env.VENOM_DASHBOARD_LOGIN_EMAIL?.trim();
  const password = process.env.VENOM_DASHBOARD_LOGIN_PASSWORD;

  if (!email || !password) {
    return null;
  }

  return {
    email: normalizeEmail(email),
    password
  };
}

export async function POST(request: Request) {
  const configured = getConfiguredCredentials();

  if (!configured) {
    return NextResponse.json(
      {
        error:
          "Dashboard login is not configured. Set VENOM_DASHBOARD_LOGIN_EMAIL and VENOM_DASHBOARD_LOGIN_PASSWORD."
      },
      { status: 500 }
    );
  }

  let payload: LoginPayload;

  try {
    payload = (await request.json()) as LoginPayload;
  } catch {
    return NextResponse.json({ error: "Invalid login payload." }, { status: 400 });
  }

  const providedEmail = normalizeEmail(payload.email || "");
  const providedPassword = payload.password || "";

  const emailMatches = safeCredentialCompare(providedEmail, configured.email);
  const passwordMatches = safeCredentialCompare(providedPassword, configured.password);

  if (!emailMatches || !passwordMatches) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = createAuthToken(configured.email);
  const session = verifyAuthToken(token);

  if (!session) {
    return NextResponse.json({ error: "Failed to initialize session." }, { status: 500 });
  }

  const response = NextResponse.json({
    ok: true,
    session
  });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  });

  return response;
}
