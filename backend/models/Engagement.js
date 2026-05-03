const mongoose = require("mongoose");

const engagementSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: ""
    },
    targetUrl: {
      type: String,
      required: true,
      trim: true
    },
    targetType: {
      type: String,
      enum: ["website", "api", "network"],
      default: "website"
    },
    scope: {
      allowedDomains: {
        type: [String],
        default: []
      },
      allowedIpRanges: {
        type: [String],
        default: []
      },
      restrictedPaths: {
        type: [String],
        default: []
      },
      restrictedServices: {
        type: [String],
        default: []
      }
    },
    authorization: {
      engagementId: {
        type: String,
        default: ""
      },
      authorizedBy: {
        type: String,
        default: ""
      },
      validFrom: {
        type: Date,
        default: Date.now
      },
      validUntil: Date,
      scopeOfWork: {
        type: String,
        default: ""
      }
    },
    constraints: {
      toolWhitelist: {
        type: [String],
        default: []
      },
      noDestructiveOps: {
        type: Boolean,
        default: true
      },
      quietMode: {
        type: Boolean,
        default: false
      },
      maxConcurrentOps: {
        type: Number,
        default: 1,
        min: 1,
        max: 20
      },
      timeoutMinutes: {
        type: Number,
        default: 60,
        min: 1,
        max: 1440
      }
    },
    status: {
      type: String,
      enum: ["draft", "running", "paused", "completed", "failed"],
      default: "draft"
    },
    createdBy: {
      type: String,
      default: "unknown"
    }
  },
  { timestamps: true }
);

engagementSchema.index({ targetUrl: 1, status: 1 });

module.exports = mongoose.model("Engagement", engagementSchema);
