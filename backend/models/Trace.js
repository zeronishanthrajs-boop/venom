const mongoose = require("mongoose");

const traceSchema = new mongoose.Schema(
  {
    engagementId: {
      type: String,
      required: true,
      index: true
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Target",
      required: true
    },
    patternId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pattern"
    },
    step: {
      type: String,
      required: true
    },
    tool: {
      type: String,
      required: true
    },
    input: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    output: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: ["queued", "running", "success", "failed", "blocked"],
      default: "queued"
    },
    startedAt: Date,
    finishedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("Trace", traceSchema);
