const mongoose = require("mongoose");

const baselineFindingSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    title: { type: String, default: "" },
    severity: {
      type: String,
      enum: ["critical", "high", "medium", "low", "info"],
      default: "low"
    },
    category: { type: String, default: "" },
    cve: { type: String, default: "" }
  },
  { _id: false }
);

const baselinePortSchema = new mongoose.Schema(
  {
    host: { type: String, default: "" },
    port: { type: Number, default: 0 },
    protocol: { type: String, default: "tcp" },
    service: { type: String, default: "" }
  },
  { _id: false }
);

const securityBaselineSchema = new mongoose.Schema(
  {
    engagementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engagement",
      required: true,
      index: true
    },
    snapshotType: {
      type: String,
      enum: ["manual", "scheduled", "post-engagement"],
      default: "manual"
    },
    snapshotAt: {
      type: Date,
      default: Date.now
    },
    findings: {
      type: [baselineFindingSchema],
      default: []
    },
    openPorts: {
      type: [baselinePortSchema],
      default: []
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    summary: {
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

securityBaselineSchema.index({ engagementId: 1, snapshotAt: -1 });

module.exports = mongoose.model("SecurityBaseline", securityBaselineSchema);

