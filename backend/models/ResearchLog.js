const mongoose = require("mongoose");

const researchSourceResultSchema = new mongoose.Schema(
  {
    source: { type: String, required: true },
    status: {
      type: String,
      enum: ["ok", "error"],
      default: "ok"
    },
    fetchedCount: { type: Number, default: 0 },
    generatedPatterns: { type: Number, default: 0 },
    summary: { type: String, default: "" },
    error: { type: String, default: "" }
  },
  { _id: false }
);

const researchLogSchema = new mongoose.Schema(
  {
    trigger: {
      type: String,
      enum: ["manual", "cron", "startup"],
      default: "manual"
    },
    startedAt: {
      type: Date,
      default: Date.now
    },
    completedAt: Date,
    durationMs: {
      type: Number,
      default: 0
    },
    sourcesChecked: {
      type: Number,
      default: 0
    },
    newPatternsCreated: {
      type: Number,
      default: 0
    },
    promptEvolutionTriggered: {
      type: Boolean,
      default: false
    },
    summary: {
      type: String,
      default: ""
    },
    sourceResults: {
      type: [researchSourceResultSchema],
      default: []
    },
    errors: {
      type: [String],
      default: []
    },
    createdBy: {
      type: String,
      default: "system"
    }
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

researchLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ResearchLog", researchLogSchema);
