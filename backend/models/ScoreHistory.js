const mongoose = require("mongoose");

const scoreHistorySchema = new mongoose.Schema(
  {
    engagementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engagement",
      required: true,
      index: true
    },
    domain: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    breakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  { timestamps: true }
);

scoreHistorySchema.index({ engagementId: 1, domain: 1, timestamp: -1 });

module.exports = mongoose.model("ScoreHistory", scoreHistorySchema);
