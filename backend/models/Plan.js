const mongoose = require("mongoose");

const planPhaseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    goal: { type: String, required: true },
    priorityScore: {
      type: Number,
      min: 1,
      max: 10,
      default: 5
    },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium"
    },
    checks: { type: [String], default: [] },
    evidence: { type: [String], default: [] },
    stopConditions: { type: [String], default: [] }
  },
  { _id: false }
);

const learnedPatternSchema = new mongoose.Schema(
  {
    condition: { type: String, default: "" },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    learnedFrom: { type: Number, min: 0, default: 0 },
    successRate: { type: Number, min: 0, max: 1, default: 0 }
  },
  { _id: false }
);

const learnedRecommendationSchema = new mongoose.Schema(
  {
    condition: { type: String, default: "" },
    tool: { type: String, default: "" },
    paramAdjustment: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    expectedSuccess: { type: Number, min: 0, max: 1, default: 0 }
  },
  { _id: false }
);

const planSchema = new mongoose.Schema(
  {
    engagementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engagement",
      required: true,
      index: true
    },
    promptVersion: {
      type: String,
      required: true
    },
    plannerSource: {
      type: String,
      enum: ["gemini", "gemini-api", "claude", "claude-api", "template"],
      required: true
    },
    model: {
      type: String,
      required: true
    },
    fallbackReason: {
      type: String,
      default: ""
    },
    rationale: {
      type: String,
      default: ""
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5
    },
    learnedPatterns: {
      type: [learnedPatternSchema],
      default: []
    },
    learnedRecommendations: {
      type: [learnedRecommendationSchema],
      default: []
    },
    summary: {
      type: String,
      default: ""
    },
    phases: {
      type: [planPhaseSchema],
      default: []
    },
    riskNotes: {
      type: [String],
      default: []
    },
    disclaimers: {
      type: [String],
      default: []
    },
    inputSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    rawModelOutput: {
      type: String,
      default: ""
    },
    createdBy: {
      type: String,
      default: "unknown"
    }
  },
  { timestamps: true }
);

planSchema.index({ engagementId: 1, createdAt: -1 });

module.exports = mongoose.model("Plan", planSchema);
