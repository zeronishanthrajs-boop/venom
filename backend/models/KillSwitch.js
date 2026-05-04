const mongoose = require("mongoose");

const killSwitchSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      enum: ["global", "engagement"],
      required: true,
      index: true
    },
    engagementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engagement",
      default: null,
      index: true
    },
    active: {
      type: Boolean,
      default: false
    },
    reason: {
      type: String,
      default: ""
    },
    updatedBy: {
      type: String,
      default: "unknown"
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
);

killSwitchSchema.index({ scope: 1, engagementId: 1 });

module.exports = mongoose.model("KillSwitch", killSwitchSchema);

