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
      enum: [
        "queued",
        "running",
        "success",
        "failed",
        "blocked",
        "timeout",
        "not_applicable",
        "tool_not_installed",
        "error"
      ],
      default: "queued"
    },
    startedAt: Date,
    finishedAt: Date,
    durationMs: Number,
    output: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    findings: {
      type: [
        {
          id: { type: String, default: "" },
          severity: {
            type: String,
            enum: ["critical", "high", "medium", "low", "info"],
            default: "low"
          },
          category: { type: String, default: "" },
          title: { type: String, default: "" },
          description: { type: String, default: "" },
          recommendation: { type: String, default: "" },
          evidence: {
            type: mongoose.Schema.Types.Mixed,
            default: null
          },
          discoveryVector: { type: String, default: "" },
          reproductionSteps: {
            type: [String],
            default: []
          },
          detectionConfidence: {
            type: String,
            enum: ["informational", "weak signal", "strong signal", "confirmed"],
            default: "strong signal"
          },
          exploitConfidence: {
            type: String,
            enum: ["informational", "weak signal", "strong signal", "confirmed"],
            default: "weak signal"
          },
          confidence: {
            type: String,
            enum: ["CONFIRMED", "STRONG_SIGNAL", "WEAK_SIGNAL", "INFORMATIONAL"]
          },
          confidenceScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 70
          },
          manualValidationRequired: {
            type: Boolean,
            default: true
          },
          manualValidationNote: {
            type: String,
            default:
              "Manual validation recommended before treating as confirmed vulnerability."
          },
          endpointType: { type: String, default: "" },
          endpointSensitivity: { type: String, default: "" },
          severityReason: { type: String, default: "" },
          exploitationPotential: { type: String, default: "" },
          rootCauseId: { type: String, default: "" },
          rootCauseLabel: { type: String, default: "" },
          affectedParameter: { type: String, default: "" },
          instanceCount: { type: Number, default: 1 },
          affectedAssets: {
            type: [String],
            default: []
          },
          firstSeen: { type: String, default: "" },
          lastSeen: { type: String, default: "" },
          representative: {
            type: mongoose.Schema.Types.Mixed,
            default: null
          },
          allInstances: {
            type: [mongoose.Schema.Types.Mixed],
            default: []
          },
          deduplicationFingerprint: { type: String, default: "" },
          cve: { type: String, default: null },
          source: { type: String, default: "" },
          tags: {
            type: [String],
            default: []
          },
          cvssScore: {
            type: Number,
            default: null
          },
          exploitAvailable: {
            type: Boolean,
            default: false
          },
          translations: {
            founder: { type: String, default: "" },
            engineer: { type: String, default: "" },
            brief: { type: String, default: "" }
          },
          metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
          }
        }
      ],
      default: []
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
