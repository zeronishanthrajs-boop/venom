module.exports = function activityLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const userId = req.user?.id || "anonymous";
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} user=${userId} status=${res.statusCode} duration_ms=${durationMs}`
    );
  });

  next();
};
