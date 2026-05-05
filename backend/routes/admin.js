const express = require("express");
const mongoose = require("mongoose");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const Plan = require("../models/Plan");
const requireDb = require("../middleware/requireDb");
const { STARTUP_SCAN_PROFILE } = require("../profiles/startupScan");

const router = express.Router();

function normalizeEngagementIds(values = []) {
  const unique = new Set();
  const ids = [];
  for (const value of values) {
    const asString = String(value || "").trim();
    if (!mongoose.Types.ObjectId.isValid(asString)) {
      continue;
    }
    if (unique.has(asString)) {
      continue;
    }
    unique.add(asString);
    ids.push(new mongoose.Types.ObjectId(asString));
  }
  return ids;
}

router.post("/fix-draft-statuses", requireDb, async (_req, res, next) => {
  try {
    const [rawJobEngagementIds, rawPlanEngagementIds] = await Promise.all([
      ExecutionJob.distinct("engagementId"),
      Plan.distinct("engagementId")
    ]);
    const engagementIds = normalizeEngagementIds([
      ...rawJobEngagementIds,
      ...rawPlanEngagementIds
    ]);

    if (engagementIds.length === 0) {
      return res.status(200).json({
        updated: 0,
        scannedEngagementsWithArtifacts: 0
      });
    }

    const result = await Engagement.updateMany(
      {
        _id: { $in: engagementIds },
        status: {
          $in: ["draft", "DRAFT", "Draft"]
        }
      },
      {
        $set: { status: "running" }
      }
    );

    return res.status(200).json({
      updated: result.modifiedCount || 0,
      scannedEngagementsWithArtifacts: engagementIds.length
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/fix-tool-whitelists", requireDb, async (_req, res, next) => {
  try {
    const whitelist = Array.isArray(STARTUP_SCAN_PROFILE.toolWhitelist)
      ? STARTUP_SCAN_PROFILE.toolWhitelist
      : [];

    const result = await Engagement.updateMany(
      {
        $or: [
          { "constraints.toolWhitelist": { $exists: false } },
          { "constraints.toolWhitelist": { $size: 0 } }
        ]
      },
      {
        $set: {
          "constraints.toolWhitelist": whitelist
        }
      }
    );

    return res.status(200).json({
      updated: result.modifiedCount || 0,
      whitelistApplied: whitelist
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/fix-orphaned-jobs", requireDb, async (_req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000);
    const result = await ExecutionJob.updateMany(
      {
        status: "running",
        startedAt: { $lt: cutoff }
      },
      {
        $set: {
          status: "failed",
          errorMessage: "Job timed out - marked failed by cleanup.",
          finishedAt: new Date()
        }
      }
    );

    return res.status(200).json({
      cleaned: result.modifiedCount || 0,
      cutoff: cutoff.toISOString()
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
