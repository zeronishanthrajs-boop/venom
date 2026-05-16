const mongoose = require("mongoose");

const nextToolSchema = new mongoose.Schema(
  {
    tool: {
      type: String,
      trim: true,
      default: ""
    },
    paramAdjustment: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    expectedSuccess: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    }
  },
  { _id: false }
);

const attackConditionSchema = new mongoose.Schema(
  {
    finding: {
      type: String,
      trim: true,
      default: ""
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    learnedFrom: {
      type: Number,
      min: 0,
      default: 0
    },
    successRate: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    nextTools: {
      type: [nextToolSchema],
      default: []
    }
  },
  { _id: false }
);

const attackGraphSchema = new mongoose.Schema(
  {
    conditions: {
      type: [attackConditionSchema],
      default: []
    },
    lastUpdated: {
      type: Date,
      default: null
    },
    engagementsSeen: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  { _id: false }
);

const patternSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    description: {
      type: String,
      default: ""
    },
    targetType: {
      type: String,
      enum: ["website", "api", "network", "mixed"],
      default: "website"
    },
    successCount: {
      type: Number,
      default: 0
    },
    failureCount: {
      type: Number,
      default: 0
    },
    successRate: {
      type: Number,
      default: 0
    },
    confidence: {
      type: Number,
      default: 0
    },
    recentOutcomes: {
      type: [Boolean],
      default: []
    },
    recentSuccessRate: {
      type: Number,
      default: 0
    },
    generalizationScore: {
      type: Number,
      default: 0.5
    },
    prerequisites: {
      type: [String],
      default: []
    },
    assessmentSequence: {
      type: [String],
      default: []
    },
    source: {
      type: String,
      default: "system"
    },
    attackGraph: {
      type: attackGraphSchema,
      default: () => ({
        conditions: [],
        lastUpdated: null,
        engagementsSeen: 0
      })
    },
    lastUsedAt: Date,
    tags: {
      type: [String],
      default: []
    }
  },
  { timestamps: true }
);

patternSchema.index({ targetType: 1, successRate: -1 });
patternSchema.index({ "attackGraph.conditions.finding": 1 });

module.exports = mongoose.model("Pattern", patternSchema);
