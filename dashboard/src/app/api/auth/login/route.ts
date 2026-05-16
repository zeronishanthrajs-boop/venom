import { NextResponse } from "next/server";

import {
  createAuthTokens,
  getAuthRequestContext,
  normalizeEmail,
  safeCredentialCompare
} from "@/lib/auth";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_NAME
} from "@/lib/authConstants";

export const runtime = "nodejs";

type LoginPayload = {
  email?: string;
  password?: string;
};

type LoginAttemptEntry = {
  count: number;
  resetAt: number;
};

const LOGIN_WINDOW_MS = Number.parseInt(
  process.env.DASHBOARD_LOGIN_RATE_WINDOW_MS || "900000",
  10
);
const LOGIN_MAX_ATTEMPTS = Number.parseInt(
  process.env.DASHBOARD_LOGIN_RATE_MAX || "5",
  10
);
const loginAttempts = new Map<string, LoginAttemptEntry>();

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

function getClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwarded = forwardedFor ? forwardedFor.split(",")[0].trim() : "";
  const ua = request.headers.get("user-agent") || "unknown-agent";
  return `${forwarded || "unknown-ip"}|${ua}`;
}

function checkLoginRateLimit(clientKey: string) {
  const now = Date.now();
  const existing = loginAttempts.get(clientKey);
  if (!existing || now > existing.resetAt) {
    loginAttempts.set(clientKey, {
      count: 0,
      resetAt: now + LOGIN_WINDOW_MS
    });
    return {
      allowed: true,
      remaining: LOGIN_MAX_ATTEMPTS
    };
  }

  if (existing.count >= LOGIN_MAX_ATTEMPTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((existing.resetAt - now) / 1000)
    };
  }

  return {
    allowed: true,
    remaining: Math.max(LOGIN_MAX_ATTEMPTS - existing.count, 0)
  };
}

function registerFailedAttempt(clientKey: string) {
  const now = Date.now();
  const existing = loginAttempts.get(clientKey);
  if (!existing || now > existing.resetAt) {
    loginAttempts.set(clientKey, {
      count: 1,
      resetAt: now + LOGIN_WINDOW_MS
    });
    return;
  }
  existing.count += 1;
  loginAttempts.set(clientKey, existing);
}

function clearAttempts(clientKey: string) {
  loginAttempts.delete(clientKey);
}

export async function POST(request: Request) {
  const clientKey = getClientKey(request);
  const rateCheck = checkLoginRateLimit(clientKey);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts, try again later." },
      {
        status: 429,
        headers: {
          "retry-after": String(rateCheck.retryAfterSec || 60)
        }
      }
    );
  }

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
    registerFailedAttempt(clientKey);
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const context = getAuthRequestContext(new Headers(request.headers));
  const tokenPair = await createAuthTokens(configured.email, context).catch(() => null);
  if (!tokenPair) {
    return NextResponse.json(
      { error: "Failed to initialize session." },
      { status: 500 }
    );
  }

  clearAttempts(clientKey);

  const response = NextResponse.json({
    ok: true,
    session: tokenPair.session
  });

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: tokenPair.accessToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
  });
  response.cookies.set({
    name: REFRESH_COOKIE_NAME,
    value: tokenPair.refreshToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS
  });

  return response;
}
