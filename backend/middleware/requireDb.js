const mongoose = require("mongoose");

module.exports = function requireDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: "Database unavailable. Configure MONGODB_URI before using this endpoint."
    });
  }

  next();
};
