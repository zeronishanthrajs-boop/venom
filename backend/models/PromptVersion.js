const mongoose = require("mongoose");

const promptVersionSchema = new mongoose.Schema(
  {
    promptType: {
      type: String,
      enum: ["planning", "tagging", "chain", "learning", "research"],
      required: true,
      index: true
    },
    version: {
      type: String,
      required: true
    },
    content: {
      type: String,
      required: true
    },
    parentVersion: {
      type: String,
      default: "base"
    },
    evolutionReason: {
      type: String,
      default: ""
    },
    performanceMetrics: {
      avgFindingsPerEngagement: { type: Number, default: 0 },
      avgPlanQualityScore: { type: Number, default: 0 },
      totalEngagementsUsed: { type: Number, default: 0 },
      successRate: { type: Number, default: 0 }
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true
    },
    createdByAI: {
      type: Boolean,
      default: true
    },
    createdBy: {
      type: String,
      default: "venom-system"
    }
  },
  { timestamps: true }
);

promptVersionSchema.index({ promptType: 1, createdAt: -1 });
promptVersionSchema.index({ promptType: 1, version: 1 }, { unique: true });

module.exports = mongoose.model("PromptVersion", promptVersionSchema);
