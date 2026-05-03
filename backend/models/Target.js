const mongoose = require("mongoose");

const targetSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    url: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ["website", "api", "network"],
      default: "website"
    },
    scope: {
      allowList: {
        type: [String],
        default: []
      },
      denyList: {
        type: [String],
        default: []
      }
    },
    tags: {
      type: [String],
      default: []
    },
    createdBy: {
      type: String,
      default: "unknown"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Target", targetSchema);
