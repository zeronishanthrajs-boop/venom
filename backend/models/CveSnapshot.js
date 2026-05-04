const mongoose = require("mongoose");

const cveSnapshotSchema = new mongoose.Schema(
  {
    cveId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    publishedAt: {
      type: Date,
      default: null
    },
    lastModifiedAt: {
      type: Date,
      default: null
    },
    sourceIdentifier: {
      type: String,
      default: ""
    },
    status: {
      type: String,
      default: ""
    },
    description: {
      type: String,
      default: ""
    },
    cvssScore: {
      type: Number,
      min: 0,
      max: 10,
      default: null
    },
    cvssSeverity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL", ""],
      default: ""
    },
    cvssVector: {
      type: String,
      default: ""
    },
    cweIds: {
      type: [String],
      default: []
    },
    references: {
      type: [String],
      default: []
    },
    cpes: {
      type: [String],
      default: []
    },
    tags: {
      type: [String],
      default: []
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

cveSnapshotSchema.index({ publishedAt: -1 });
cveSnapshotSchema.index({ lastModifiedAt: -1 });
cveSnapshotSchema.index({ cvssScore: -1 });
cveSnapshotSchema.index({ tags: 1 });

module.exports = mongoose.model("CveSnapshot", cveSnapshotSchema);
