const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    method: { type: String, default: "GET" },
    path: { type: String, default: "/" },
    statusCode: { type: Number, default: 200 },
    durationMs: { type: Number, default: 0 },
    userId: { type: String, default: "anonymous" },
    userRole: { type: String, default: "unknown" },
    ip: { type: String, default: "" },
    query: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    bodyKeys: {
      type: [String],
      default: []
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: false }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);

