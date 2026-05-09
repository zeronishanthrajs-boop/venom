const mongoose = require("mongoose");

const topRiskSchema = new mongoose.Schema(
  {
    rank: { type: Number, required: true, min: 1, max: 3 },
    title: { type: String, default: "" },
    whyThisFirst: { type: String, default: "" },
    whatCouldHappen: { type: String, default: "" },
    fixDifficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium"
    },
    estimatedFixTime: { type: String, default: "" },
    immediateAction: { type: String, default: "" }
  },
  { _id: false }
);

const ignoreItemSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    reason: { type: String, default: "" }
  },
  { _id: false }
);

const decisionBriefSchema = new mongoose.Schema(
  {
    engagementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engagement",
      required: true,
      index: true
    },
    topRisks: {
      type: [topRiskSchema],
      default: []
    },
    ignoreList: {
      type: [ignoreItemSchema],
      default: []
    },
    overallRiskSentence: {
      type: String,
      default: "No findings yet."
    },
    riskLevel: {
      type: String,
      enum: ["critical", "high", "medium", "low", "clean", "unknown"],
      default: "unknown"
    },
    shouldPageOnCall: {
      type: Boolean,
      default: false
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    totalFindings: {
      type: Number,
      default: 0,
      min: 0
    },
    actionableFindings: {
      type: Number,
      default: 0,
      min: 0
    },
    ignoredFindings: {
      type: Number,
      default: 0,
      min: 0
    },
    source: {
      type: String,
      enum: ["heuristic", "gemini", "claude"],
      default: "heuristic"
    },
    generatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

decisionBriefSchema.index({ engagementId: 1, generatedAt: -1 });

module.exports = mongoose.model("DecisionBrief", decisionBriefSchema);
