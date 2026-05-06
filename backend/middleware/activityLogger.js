const ActivityLog = require("../models/ActivityLog");
const { getDbStatus } = require("../config/db");
const { logger } = require("../config/logger");

module.exports = function activityLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const userId = req.user?.id || "anonymous";
    const userRole = req.user?.role || "unknown";
    logger.info(
      {
        method: req.method,
        path: req.originalUrl,
        userId,
        userRole,
        statusCode: res.statusCode,
        durationMs
      },
      "HTTP activity"
    );

    if (getDbStatus().readyState !== 1) {
      return;
    }

    const query =
      req.query && typeof req.query === "object" ? { ...req.query } : {};
    const bodyKeys =
      req.body && typeof req.body === "object"
        ? Object.keys(req.body).slice(0, 40)
        : [];

    ActivityLog.create({
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      userId,
      userRole,
      ip: req.ip || req.socket?.remoteAddress || "",
      query,
      bodyKeys
    }).catch(() => null);
  });

  next();
};
