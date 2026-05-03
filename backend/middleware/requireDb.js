const mongoose = require("mongoose");

module.exports = function requireDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error:
        "Database unavailable. Configure MONGODB_URI or set ENABLE_INMEMORY_DB=true for local development."
    });
  }

  next();
};
