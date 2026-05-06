const pino = require("pino");
const { maskSecret } = require("../utils/secretMasker");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.x-api-key",
      "req.headers.authorization",
      "authorization",
      "apiKey",
      "token",
      "password",
      "mongoUri",
      "jwtSecret",
      "*.apiKey",
      "*.authorization",
      "*.token",
      "*.password"
    ],
    censor: "***"
  },
  formatters: {
    bindings(bindings) {
      return {
        pid: bindings.pid
      };
    }
  }
});

function withMaskedSecrets(meta = {}) {
  if (!meta || typeof meta !== "object") {
    return meta;
  }

  const next = { ...meta };
  if (typeof next.apiKey === "string") {
    next.apiKey = maskSecret(next.apiKey);
  }
  if (typeof next.authorization === "string") {
    next.authorization = maskSecret(next.authorization);
  }
  if (typeof next.mongoUri === "string") {
    next.mongoUri = maskSecret(next.mongoUri);
  }
  if (typeof next.jwtSecret === "string") {
    next.jwtSecret = maskSecret(next.jwtSecret);
  }
  return next;
}

module.exports = {
  logger,
  withMaskedSecrets
};
