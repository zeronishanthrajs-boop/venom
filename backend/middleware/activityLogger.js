const ActivityLog = require("../models/ActivityLog");
const { getDbStatus } = require("../config/db");

module.exports = function activityLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const userId = req.user?.id || "anonymous";
    const userRole = req.user?.role || "unknown";
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} user=${userId} role=${userRole} status=${res.statusCode} duration_ms=${durationMs}`
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
