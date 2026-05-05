const express = require("express");
const mongoose = require("mongoose");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");

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
    const rawEngagementIds = await ExecutionJob.distinct("engagementId");
    const engagementIds = normalizeEngagementIds(rawEngagementIds);

    if (engagementIds.length === 0) {
      return res.status(200).json({
        updated: 0,
        scannedEngagementsWithJobs: 0
      });
    }

    const result = await Engagement.updateMany(
      {
        _id: { $in: engagementIds },
        status: "draft"
      },
      {
        $set: { status: "running" }
      }
    );

    return res.status(200).json({
      updated: result.modifiedCount || 0,
      scannedEngagementsWithJobs: engagementIds.length
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
