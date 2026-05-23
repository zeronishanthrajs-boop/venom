import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_MAX_AGE_SECONDS
} from "@/lib/authConstants";
import {
  getSessionRecordById,
  revokeSessionRecord,
  saveSessionRecord,
  updateSessionRecord
} from "@/lib/sessionStore";

type DashboardAuthRole = "owner";

type AccessTokenPayload = {
  typ: "access";
  sid: string;
  email: string;
  role: DashboardAuthRole;
  iat: number;
  exp: number;
  uaHash: string;
  ipHash: string | null;
};

type RefreshTokenPayload = {
  typ: "refresh";
  sid: string;
  email: string;
  role: DashboardAuthRole;
  iat: number;
  exp: number;
  uaHash: string;
  ipHash: string | null;
  nonce: string;
};

type AuthTokenPayload = AccessTokenPayload | RefreshTokenPayload;

export type DashboardAuthSession = {
  sid: string;
  email: string;
  role: DashboardAuthRole;
  issuedAt: string;
  expiresAt: string;
};

export type AuthRequestContext = {
  userAgent: string;
  ip: string | null;
};

type AuthTokenPair = {
  accessToken: string;
  refreshToken: string;
  session: DashboardAuthSession;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  uaHash: string;
  ipHash: string | null;
};

let runtimeFallbackSecret = "";

function toUnixSeconds(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}

function toIsoFromUnixSeconds(value: number) {
  return new Date(value * 1000).toISOString();
}

function getSessionSecret() {
  const configured = process.env.VENOM_DASHBOARD_SESSION_SECRET?.trim();
  if (configured) {
    return configured;
  }

  if (!runtimeFallbackSecret) {
    runtimeFallbackSecret = crypto.randomBytes(32).toString("hex");
  }

  return runtimeFallbackSecret;
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

function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashTokenValue(token: string) {
  return hashValue(token);
}

function normalizeIp(value: string) {
  let normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("::ffff:")) {
    normalized = normalized.slice("::ffff:".length);
  }
  if (normalized.includes(",")) {
    normalized = normalized.split(",")[0].trim();
  }

  if (normalized.includes(":") && normalized.includes(".")) {
    const parts = normalized.split(":");
    normalized = parts[parts.length - 1];
  }

  return normalized.trim();
}

function toBoundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function getIpv4BucketOctets() {
  return toBoundedInteger(
    process.env.VENOM_DASHBOARD_IPV4_BUCKET_OCTETS,
    2,
    1,
    4
  );
}

function getIpv6BucketSegments() {
  return toBoundedInteger(
    process.env.VENOM_DASHBOARD_IPV6_BUCKET_SEGMENTS,
    3,
    1,
    8
  );
}

function toIpv4Bucket(ip: string, octets: number) {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return ip;
  }
  if (octets >= 4) {
    return parts.join(".");
  }
  return `${parts.slice(0, octets).join(".")}.*`;
}

function toIpv6Bucket(ip: string, segments: number) {
  const parts = ip.split(":").filter(Boolean);
  if (parts.length === 0) {
    return ip;
  }
  const boundedSegments = Math.min(Math.max(segments, 1), parts.length);
  if (boundedSegments >= parts.length) {
    return parts.join(":");
  }
  return `${parts.slice(0, boundedSegments).join(":")}:*`;
}

function uniqueBuckets(values: string[]) {
  const buckets = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    buckets.push(normalized);
  }
  return buckets;
}

function buildIpBucketCandidates(value: string) {
  const ip = normalizeIp(value);
  if (!ip) {
    return [];
  }

  if (ip.includes(".")) {
    const preferred = toIpv4Bucket(ip, getIpv4BucketOctets());
    // Keep legacy /24 compatibility for pre-existing sessions.
    const legacy = toIpv4Bucket(ip, 3);
    return uniqueBuckets([preferred, legacy]);
  }

  if (ip.includes(":")) {
    const preferred = toIpv6Bucket(ip, getIpv6BucketSegments());
    // Keep legacy /64 compatibility for pre-existing sessions.
    const legacy = toIpv6Bucket(ip, 4);
    return uniqueBuckets([preferred, legacy]);
  }

  return [ip];
}

function toIpBucket(value: string) {
  const candidates = buildIpBucketCandidates(value);
  return candidates[0] || "";
}

function normalizeUserAgent(value: string) {
  return String(value || "").trim().toLowerCase().slice(0, 256) || "unknown-agent";
}

function enforceIpBinding() {
  return process.env.VENOM_DASHBOARD_BIND_IP !== "false";
}

function buildContextBinding(context: AuthRequestContext) {
  const userAgent = normalizeUserAgent(context.userAgent);
  const ipBucket = toIpBucket(context.ip || "");

  return {
    uaHash: hashValue(userAgent),
    ipHash: ipBucket && enforceIpBinding() ? hashValue(ipBucket) : null
  };
}

function matchesContextIpHash(expectedHash: string, contextIp: string | null) {
  if (!enforceIpBinding()) {
    return false;
  }
  const candidates = buildIpBucketCandidates(contextIp || "");
  if (candidates.length === 0) {
    return false;
  }
  return candidates.some((bucket) => safeCompare(expectedHash, hashValue(bucket)));
}

function verifyContextBinding(payload: AuthTokenPayload, context: AuthRequestContext) {
  const binding = buildContextBinding(context);
  if (!safeCompare(payload.uaHash, binding.uaHash)) {
    return false;
  }
  if (payload.ipHash) {
    if (!matchesContextIpHash(payload.ipHash, context.ip)) {
      return false;
    }
  }
  return true;
}

function getClientIpFromHeaders(headers: Headers) {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")
  ];
  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate || "");
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function getAuthRequestContext(headers: Headers): AuthRequestContext {
  return {
    userAgent: normalizeUserAgent(headers.get("user-agent") || "unknown-agent"),
    ip: getClientIpFromHeaders(headers)
  };
}

function encodeTokenPayload(payload: AuthTokenPayload) {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseToken(token?: string | null) {
  if (!token) {
    return null;
  }
  const [encodedPayload, signature] = String(token).split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  if (!safeCompare(signature, expectedSignature)) {
    return null;
  }

  try {
    return JSON.parse(fromBase64Url(encodedPayload)) as AuthTokenPayload;
  } catch {
    return null;
  }
}

function isTokenPayload(value: unknown): value is AuthTokenPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<AuthTokenPayload>;
  if (payload.typ !== "access" && payload.typ !== "refresh") {
    return false;
  }
  if (!payload.sid || !payload.email || !payload.role || !payload.iat || !payload.exp) {
    return false;
  }
  if (!payload.uaHash || typeof payload.uaHash !== "string") {
    return false;
  }
  if (payload.ipHash !== null && payload.ipHash !== undefined && typeof payload.ipHash !== "string") {
    return false;
  }
  if (payload.typ === "refresh" && !payload.nonce) {
    return false;
  }
  return true;
}

function decodeSignedToken(
  token?: string | null,
  options: { allowExpired?: boolean } = {}
) {
  const payload = parseToken(token);
  if (!isTokenPayload(payload)) {
    return null;
  }

  if (!options.allowExpired && Date.now() >= payload.exp * 1000) {
    return null;
  }
  return payload;
}

function toSessionFromPayload(payload: AccessTokenPayload): DashboardAuthSession {
  return {
    sid: payload.sid,
    email: payload.email,
    role: payload.role,
    issuedAt: toIsoFromUnixSeconds(payload.iat),
    expiresAt: toIsoFromUnixSeconds(payload.exp)
  };
}

function issueTokenPair(
  sid: string,
  email: string,
  role: DashboardAuthRole,
  context: AuthRequestContext
): AuthTokenPair {
  const iat = toUnixSeconds();
  const accessExp = iat + AUTH_COOKIE_MAX_AGE_SECONDS;
  const refreshExp = iat + REFRESH_COOKIE_MAX_AGE_SECONDS;
  const binding = buildContextBinding(context);
  const accessPayload: AccessTokenPayload = {
    typ: "access",
    sid,
    email,
    role,
    iat,
    exp: accessExp,
    uaHash: binding.uaHash,
    ipHash: binding.ipHash
  };
  const refreshPayload: RefreshTokenPayload = {
    typ: "refresh",
    sid,
    email,
    role,
    iat,
    exp: refreshExp,
    uaHash: binding.uaHash,
    ipHash: binding.ipHash,
    nonce: randomUUID()
  };

  const accessToken = encodeTokenPayload(accessPayload);
  const refreshToken = encodeTokenPayload(refreshPayload);

  return {
    accessToken,
    refreshToken,
    session: toSessionFromPayload(accessPayload),
    accessExpiresAt: toIsoFromUnixSeconds(accessExp),
    refreshExpiresAt: toIsoFromUnixSeconds(refreshExp),
    uaHash: binding.uaHash,
    ipHash: binding.ipHash
  };
}

async function ensureActiveSession(
  payload: AuthTokenPayload,
  context: AuthRequestContext
) {
  if (!verifyContextBinding(payload, context)) {
    return null;
  }

  const record = await getSessionRecordById(payload.sid);
  if (!record) {
    return null;
  }
  if (record.revokedAt) {
    return null;
  }
  if (record.email !== payload.email || record.role !== payload.role) {
    return null;
  }
  if (!safeCompare(record.uaHash, payload.uaHash)) {
    return null;
  }
  if (record.ipHash && payload.ipHash && !safeCompare(record.ipHash, payload.ipHash)) {
    return null;
  }
  if (Date.now() >= new Date(record.refreshExpiresAt).getTime()) {
    await revokeSessionRecord(payload.sid, "refresh_expired");
    return null;
  }
  return record;
}

export async function createAuthTokens(
  email: string,
  context: AuthRequestContext
) {
  const normalizedEmail = normalizeEmail(email);
  const sid = randomUUID();
  const pair = issueTokenPair(sid, normalizedEmail, "owner", context);

  await saveSessionRecord({
    sid,
    email: normalizedEmail,
    role: "owner",
    uaHash: pair.uaHash,
    ipHash: pair.ipHash,
    refreshTokenHash: hashTokenValue(pair.refreshToken),
    createdAt: new Date().toISOString(),
    accessExpiresAt: pair.accessExpiresAt,
    refreshExpiresAt: pair.refreshExpiresAt,
    lastSeenAt: new Date().toISOString(),
    revokedAt: null,
    revokeReason: ""
  });

  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    session: pair.session
  };
}

export async function verifyAuthToken(
  token: string | null | undefined,
  context: AuthRequestContext
) {
  const payload = decodeSignedToken(token);
  if (!payload || payload.typ !== "access") {
    return null;
  }

  const activeSession = await ensureActiveSession(payload, context);
  if (!activeSession) {
    return null;
  }

  await updateSessionRecord(payload.sid, {
    accessExpiresAt: toIsoFromUnixSeconds(payload.exp),
    lastSeenAt: new Date().toISOString()
  }).catch(() => undefined);

  return toSessionFromPayload(payload);
}

export async function refreshAuthTokens(
  refreshToken: string | null | undefined,
  context: AuthRequestContext
) {
  const payload = decodeSignedToken(refreshToken);
  if (!payload || payload.typ !== "refresh") {
    return null;
  }

  const activeSession = await ensureActiveSession(payload, context);
  if (!activeSession) {
    return null;
  }

  const expectedHash = activeSession.refreshTokenHash;
  const providedHash = hashTokenValue(String(refreshToken || ""));
  if (!safeCompare(expectedHash, providedHash)) {
    await revokeSessionRecord(payload.sid, "refresh_token_mismatch");
    return null;
  }

  const nextPair = issueTokenPair(
    payload.sid,
    payload.email,
    payload.role,
    context
  );
  await updateSessionRecord(payload.sid, {
    refreshTokenHash: hashTokenValue(nextPair.refreshToken),
    accessExpiresAt: nextPair.accessExpiresAt,
    refreshExpiresAt: nextPair.refreshExpiresAt,
    lastSeenAt: new Date().toISOString(),
    ipHash: nextPair.ipHash
  });

  return {
    accessToken: nextPair.accessToken,
    refreshToken: nextPair.refreshToken,
    session: nextPair.session
  };
}

export async function revokeAuthTokens(
  token: string | null | undefined,
  reason = "logout"
) {
  const payload = decodeSignedToken(token, { allowExpired: true });
  if (!payload) {
    return;
  }
  await revokeSessionRecord(payload.sid, reason);
}

export function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function safeCredentialCompare(left: string, right: string) {
  return safeCompare(left, right);
}
