import crypto from "node:crypto";

import {
  AUTH_COOKIE_MAX_AGE_SECONDS
} from "@/lib/authConstants";

export type DashboardAuthSession = {
  email: string;
  role: "owner";
  expiresAt: string;
};

const DEFAULT_DEV_SESSION_SECRET = "venom-local-session-secret-change-me";

function getSessionSecret() {
  return (
    process.env.VENOM_DASHBOARD_SESSION_SECRET?.trim() ||
    DEFAULT_DEV_SESSION_SECRET
  );
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAuthToken(email: string): string {
  const payload: DashboardAuthSession = {
    email: email.trim().toLowerCase(),
    role: "owner",
    expiresAt: new Date(
      Date.now() + AUTH_COOKIE_MAX_AGE_SECONDS * 1000
    ).toISOString()
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token?: string | null): DashboardAuthSession | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as DashboardAuthSession;
    const expiresAt = new Date(parsed.expiresAt).getTime();

    if (!parsed.email || parsed.role !== "owner" || Number.isNaN(expiresAt)) {
      return null;
    }

    if (Date.now() >= expiresAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function safeCredentialCompare(left: string, right: string) {
  return safeCompare(left, right);
}
