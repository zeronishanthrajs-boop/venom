import crypto from "node:crypto";

import { AUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/authConstants";

const revokedTokenHashes = new Map<string, number>();

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function pruneExpiredRevocations(nowMs = Date.now()) {
  for (const [tokenHash, expiresAtMs] of revokedTokenHashes.entries()) {
    if (expiresAtMs <= nowMs) {
      revokedTokenHashes.delete(tokenHash);
    }
  }
}

export function revokeAuthToken(token?: string | null, expiresAt?: string | null) {
  if (!token || typeof token !== "string") {
    return;
  }

  const nowMs = Date.now();
  pruneExpiredRevocations(nowMs);

  const parsedExpiry = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  const fallbackExpiry = nowMs + AUTH_COOKIE_MAX_AGE_SECONDS * 1000;
  const expiryMs =
    Number.isFinite(parsedExpiry) && parsedExpiry > nowMs
      ? parsedExpiry
      : fallbackExpiry;

  revokedTokenHashes.set(hashToken(token), expiryMs);
}

export function isAuthTokenRevoked(token?: string | null) {
  if (!token || typeof token !== "string") {
    return false;
  }

  pruneExpiredRevocations();
  return revokedTokenHashes.has(hashToken(token));
}

