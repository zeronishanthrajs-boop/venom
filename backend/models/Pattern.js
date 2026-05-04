const mongoose = require("mongoose");

const patternSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    description: {
      type: String,
      default: ""
    },
    targetType: {
      type: String,
      enum: ["website", "api", "network", "mixed"],
      default: "website"
    },
    successCount: {
      type: Number,
      default: 0
    },
    failureCount: {
      type: Number,
      default: 0
    },
    successRate: {
      type: Number,
      default: 0
    },
    confidence: {
      type: Number,
      default: 0
    },
    recentOutcomes: {
      type: [Boolean],
      default: []
    },
    recentSuccessRate: {
      type: Number,
      default: 0
    },
    generalizationScore: {
      type: Number,
      default: 0.5
    },
    prerequisites: {
      type: [String],
      default: []
    },
    assessmentSequence: {
      type: [String],
      default: []
    },
    source: {
      type: String,
      default: "system"
    },
    lastUsedAt: Date,
    tags: {
      type: [String],
      default: []
    }
  },
  { timestamps: true }
);

patternSchema.index({ targetType: 1, successRate: -1 });

module.exports = mongoose.model("Pattern", patternSchema);
