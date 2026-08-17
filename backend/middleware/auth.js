const crypto = require("node:crypto");
const { logger } = require("../config/logger");
const { maskSecret } = require("../utils/secretMasker");
const {
  rotateJWTSecret,
  shouldRotateSecret,
  getJWTSecret,
  getPreviousJWTSecret
} = require("../config/secrets");

function safeCompare(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = function authMiddleware(req, res, next) {
  if (shouldRotateSecret()) {
    const rotation = rotateJWTSecret();
    logger.info(
      {
        rotatedAt: rotation.rotatedAt,
        expiresPreviousAt: rotation.expiresPreviousAt
      },
      "JWT/session secret rotated"
    );
  }

  const configuredApiKey = process.env.VENOM_API_KEY;
  const providedApiKey = req.get("x-api-key") || "";
  const providedUserId = req.get("x-user-id") || "";
  const providedRole = req.get("x-user-role") || "";

  const validApiKeys = new Set(
    String(process.env.VALID_API_KEYS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  if (configuredApiKey) {
    validApiKeys.add(configuredApiKey);
  }

  if (process.env.NODE_ENV === "production" && !configuredApiKey) {
    logger.error("Authentication misconfigured: VENOM_API_KEY missing in production");
    return res.status(500).json({
      errorType: "AUTH_MISCONFIGURED",
      issue: "ISSUE-BACKEND-AUTH-MISCONFIGURED",
      error: "Server auth misconfigured",
      reason: "VENOM_API_KEY is required in production and is not configured."
    });
  }

  if (!providedApiKey || !providedUserId || !providedRole) {
    return res.status(401).json({
      error: "Missing auth headers"
    });
  }

  const userIdValid =
    /^[a-fA-F0-9-]{36}$/.test(providedUserId) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(providedUserId) ||
    /^[a-zA-Z0-9._-]{3,64}$/.test(providedUserId);
  if (!userIdValid) {
    return res.status(400).json({
      error: "Invalid userId format"
    });
  }

  const normalizedRole = String(providedRole).trim().toLowerCase();
  if (!["admin", "operator", "viewer", "owner", "analyst"].includes(normalizedRole)) {
    return res.status(400).json({
      error: "Invalid role"
    });
  }

  const isValidApiKey =
    validApiKeys.size === 0
      ? Boolean(configuredApiKey && safeCompare(configuredApiKey, providedApiKey))
      : Array.from(validApiKeys).some((key) => safeCompare(key, providedApiKey));

  if (!isValidApiKey) {
    logger.warn(
      {
        userId: providedUserId,
        role: normalizedRole,
        providedKey: maskSecret(providedApiKey)
      },
      "Unauthorized API key attempt"
    );
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  req.user = {
    id: providedUserId,
    role: normalizedRole,
    // key references for future token/session validation hooks.
    keyVersion: getPreviousJWTSecret() ? "rotated-grace" : "current",
    sessionSecretPreview: maskSecret(getJWTSecret())
  };

  next();
};
