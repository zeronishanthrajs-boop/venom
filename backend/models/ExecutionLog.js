const mongoose = require("mongoose");

const executionLogSchema = new mongoose.Schema(
  {
    engagementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engagement",
      required: true,
      index: true
    },
    testId: {
      type: String,
      required: true,
      index: true
    },
    testName: {
      type: String,
      required: true
    },
    tool: {
      type: String,
      required: true
    },
    category: {
      type: String,
      default: "General"
    },
    target: {
      type: String,
      required: true
    },
    parameters: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    response: {
      statusCode: {
        type: Number,
        default: 0
      },
      headers: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      bodySize: {
        type: Number,
        default: 0
      }
    },
    result: {
      status: {
        type: String,
        enum: ["PASSED", "VULNERABLE", "BLOCKED", "FAILED"],
        default: "PASSED"
      },
      confidence: {
        type: Number,
        default: 0.5
      },
      reason: {
        type: String,
        default: ""
      },
      severity: {
        type: String,
        enum: ["critical", "high", "medium", "low", "info"],
        default: "low"
      }
    },
    executionTimeMs: {
      type: Number,
      default: 0
    },
    findingCount: {
      type: Number,
      default: 0
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

executionLogSchema.index({ engagementId: 1, createdAt: -1 });
executionLogSchema.index({ engagementId: 1, testId: 1 }, { unique: true });

module.exports = mongoose.model("ExecutionLog", executionLogSchema);
