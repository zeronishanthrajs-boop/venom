const rateLimit = require("express-rate-limit");

const apiLimiter = rateLimit({
  windowMs: Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || "60000", 10),
  max: Number.parseInt(process.env.API_RATE_LIMIT_MAX || "120", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests, please slow down."
  }
});

const authLimiter = rateLimit({
  windowMs: Number.parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "900000", 10),
  max: Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX || "5", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts, try again later."
  }
});

module.exports = {
  apiLimiter,
  authLimiter
};
