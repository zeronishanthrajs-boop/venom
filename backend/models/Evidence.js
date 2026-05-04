const crypto = require("node:crypto");
const mongoose = require("mongoose");

const GENESIS_CHAIN_HASH = "0".repeat(64);

const evidenceSchema = new mongoose.Schema(
  {
    engagementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Engagement",
      required: true,
      index: true
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ExecutionJob",
      default: null,
      index: true
    },
    evidenceType: {
      type: String,
      enum: ["screenshot", "raw_output", "finding", "network_capture", "report"],
      required: true
    },
    content: {
      type: String,
      default: ""
    },
    contentHash: {
      type: String,
      default: ""
    },
    chainHash: {
      type: String,
      default: ""
    },
    previousChainHash: {
      type: String,
      default: GENESIS_CHAIN_HASH
    },
    chainIndex: {
      type: Number,
      default: 0
    },
    collectedAt: {
      type: Date,
      default: Date.now
    },
    collectedBy: {
      type: String,
      default: "venom-system"
    },
    toolId: {
      type: String,
      default: ""
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

evidenceSchema.index({ engagementId: 1, chainIndex: 1 }, { unique: true });
evidenceSchema.index({ engagementId: 1, createdAt: -1 });

evidenceSchema.pre("validate", async function preValidate() {
  if (!this.contentHash) {
    this.contentHash = crypto
      .createHash("sha256")
      .update(String(this.content || ""))
      .digest("hex");
  }

  if (!this.chainHash) {
    const previous = await this.constructor
      .findOne({ engagementId: this.engagementId })
      .sort({ chainIndex: -1 })
      .lean();

    this.previousChainHash = previous?.chainHash || GENESIS_CHAIN_HASH;
    this.chainIndex = (previous?.chainIndex || 0) + 1;
    this.chainHash = crypto
      .createHash("sha256")
      .update(`${this.contentHash}${this.previousChainHash}`)
      .digest("hex");
  }
});

evidenceSchema.statics.verifyChain = async function verifyChain(engagementId) {
  const chain = await this.find({ engagementId }).sort({ chainIndex: 1 }).lean();
  if (chain.length === 0) {
    return { valid: true, totalItems: 0 };
  }

  for (let index = 0; index < chain.length; index += 1) {
    const current = chain[index];
    const expectedPreviousHash =
      index === 0 ? GENESIS_CHAIN_HASH : chain[index - 1].chainHash;
    if (current.previousChainHash !== expectedPreviousHash) {
      return {
        valid: false,
        brokenAt: current.chainIndex,
        reason: "previous_chain_hash_mismatch"
      };
    }

    const expectedContentHash = crypto
      .createHash("sha256")
      .update(String(current.content || ""))
      .digest("hex");
    if (current.contentHash !== expectedContentHash) {
      return {
        valid: false,
        brokenAt: current.chainIndex,
        reason: "content_hash_mismatch"
      };
    }

    const expectedChainHash = crypto
      .createHash("sha256")
      .update(`${current.contentHash}${current.previousChainHash}`)
      .digest("hex");
    if (current.chainHash !== expectedChainHash) {
      return {
        valid: false,
        brokenAt: current.chainIndex,
        reason: "chain_hash_mismatch"
      };
    }
  }

  return {
    valid: true,
    totalItems: chain.length,
    latestChainIndex: chain[chain.length - 1].chainIndex
  };
};

module.exports = mongoose.model("Evidence", evidenceSchema);
