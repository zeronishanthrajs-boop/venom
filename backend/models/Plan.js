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
      enum: ["claude", "template"],
      required: true
    },
    model: {
      type: String,
      required: true
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
