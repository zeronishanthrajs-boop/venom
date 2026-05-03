const crypto = require("node:crypto");

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
  const configuredApiKey = process.env.VENOM_API_KEY;
  const providedApiKey = req.get("x-api-key") || "";

  if (process.env.NODE_ENV === "production" && !configuredApiKey) {
    return res.status(500).json({
      error: "Server auth misconfigured"
    });
  }

  if (configuredApiKey && !safeCompare(configuredApiKey, providedApiKey)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  req.user = {
    id: req.get("x-user-id") || "local-dev-user",
    role: req.get("x-user-role") || "operator"
  };

  next();
};
