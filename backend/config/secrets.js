const crypto = require("node:crypto");

let activeSecret =
  process.env.JWT_SECRET ||
  process.env.VENOM_DASHBOARD_SESSION_SECRET ||
  crypto.randomBytes(32).toString("hex");
let previousSecret = null;
let rotatedAt = new Date();
const rotationDays = Number.parseInt(process.env.JWT_ROTATION_DAYS || "30", 10);
const graceHours = Number.parseInt(process.env.JWT_PREVIOUS_SECRET_GRACE_HOURS || "24", 10);

function getJWTSecret() {
  return activeSecret;
}

function getPreviousJWTSecret() {
  if (!previousSecret) {
    return null;
  }
  const ageMs = Date.now() - rotatedAt.getTime();
  if (ageMs > graceHours * 60 * 60 * 1000) {
    previousSecret = null;
    return null;
  }
  return previousSecret;
}

function rotateJWTSecret(nextSecret) {
  const generated = nextSecret || crypto.randomBytes(32).toString("hex");
  previousSecret = activeSecret;
  activeSecret = generated;
  rotatedAt = new Date();
  return {
    rotatedAt: rotatedAt.toISOString(),
    expiresPreviousAt: new Date(
      rotatedAt.getTime() + graceHours * 60 * 60 * 1000
    ).toISOString()
  };
}

function shouldRotateSecret() {
  const ageMs = Date.now() - rotatedAt.getTime();
  return ageMs >= rotationDays * 24 * 60 * 60 * 1000;
}

module.exports = {
  getJWTSecret,
  getPreviousJWTSecret,
  rotateJWTSecret,
  shouldRotateSecret
};
