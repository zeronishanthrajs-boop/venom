const mongoose = require("mongoose");

const executionJobSchema = new mongoose.Schema(
  {
    engagementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engagement",
      required: true,
      index: true
    },
    toolId: {
      type: String,
      required: true,
      index: true
    },
    targetUrl: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ["queued", "running", "success", "failed", "blocked", "timeout"],
      default: "queued"
    },
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
    output: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    rawOutput: {
      type: String,
      default: ""
    },
    errorMessage: {
      type: String,
      default: ""
    },
    learnedAt: Date,
    createdBy: {
      type: String,
      default: "unknown"
    }
  },
  { timestamps: true }
);

executionJobSchema.index({ engagementId: 1, createdAt: -1 });

module.exports = mongoose.model("ExecutionJob", executionJobSchema);
