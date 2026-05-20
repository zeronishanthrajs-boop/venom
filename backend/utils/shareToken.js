const crypto = require("node:crypto");

const SECRET = process.env.JWT_SECRET || process.env.VENOM_API_KEY || "venom-secret-key-123456";

function generateShareToken(engagementId, expiresAt) {
  const payload = JSON.stringify({ engagementId, expiresAt });
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ payload, signature })).toString("base64url");
}

function verifyShareToken(token) {
  try {
    const { payload, signature } = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const expectedSignature = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
    if (signature !== expectedSignature) {
      return null;
    }
    const data = JSON.parse(payload);
    if (Date.now() > data.expiresAt) {
      return null;
    }
    return data.engagementId;
  } catch (err) {
    return null;
  }
}

module.exports = {
  generateShareToken,
  verifyShareToken
};
