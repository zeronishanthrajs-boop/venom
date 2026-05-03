const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const Pattern = require("../models/Pattern");
const requireDb = require("../middleware/requireDb");
const {
  computeSuccessRate,
  appendRecentOutcomes,
  computeRecentSuccessRate,
  computeConfidence
} = require("../services/patternEngine");

const router = express.Router();

function statusToOutcome(status) {
  if (status === "success") {
    return true;
  }
  if (status === "failed" || status === "timeout" || status === "blocked") {
    return false;
  }
  return null;
}

function toPatternName(toolId) {
  return `baseline_${toolId}`;
}

router.post("/", requireDb, async (req, res, next) => {
  try {
    const { engagementId } = req.body;
    if (!engagementId || typeof engagementId !== "string") {
      return res.status(400).json({
        error: "engagementId is required"
      });
    }

    const engagement = await Engagement.findById(engagementId).lean();
    if (!engagement) {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    const jobs = await ExecutionJob.find({
      engagementId,
      learnedAt: { $exists: false }
    }).lean();

    if (jobs.length === 0) {
      return res.status(200).json({
        engagementId,
        processedJobs: 0,
        updatedPatterns: [],
        message: "No new execution jobs to learn from."
      });
    }

    const grouped = new Map();
    for (const job of jobs) {
      const key = job.toolId;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(job);
    }

    const updatedPatterns = [];
    for (const [toolId, toolJobs] of grouped.entries()) {
      const outcomes = toolJobs
        .map((job) => statusToOutcome(job.status))
        .filter((outcome) => outcome !== null);

      if (outcomes.length === 0) {
        continue;
      }

      const successIncrement = outcomes.filter(Boolean).length;
      const failureIncrement = outcomes.length - successIncrement;

      const patternName = toPatternName(toolId);
      let pattern = await Pattern.findOne({ name: patternName });
      if (!pattern) {
        pattern = new Pattern({
          name: patternName,
          description: `Auto-learned baseline pattern derived from ${toolId} execution outcomes.`,
          targetType:
            engagement.targetType === "website" ||
            engagement.targetType === "api" ||
            engagement.targetType === "network"
              ? engagement.targetType
              : "mixed",
          tags: [toolId, engagement.targetType]
        });
      }

      pattern.successCount += successIncrement;
      pattern.failureCount += failureIncrement;
      pattern.successRate = computeSuccessRate(
        pattern.successCount,
        pattern.failureCount
      );
      pattern.recentOutcomes = appendRecentOutcomes(pattern.recentOutcomes, outcomes);
      pattern.recentSuccessRate = computeRecentSuccessRate(pattern.recentOutcomes);
      pattern.confidence = computeConfidence(
        pattern.successRate,
        pattern.recentSuccessRate,
        pattern.successCount + pattern.failureCount
      );
      pattern.lastUsedAt = new Date();
      await pattern.save();

      updatedPatterns.push({
        patternId: pattern._id,
        name: pattern.name,
        successCount: pattern.successCount,
        failureCount: pattern.failureCount,
        successRate: pattern.successRate,
        recentSuccessRate: pattern.recentSuccessRate,
        confidence: pattern.confidence
      });
    }

    await ExecutionJob.updateMany(
      {
        _id: { $in: jobs.map((job) => job._id) }
      },
      {
        $set: { learnedAt: new Date() }
      }
    );

    return res.status(200).json({
      engagementId,
      processedJobs: jobs.length,
      updatedPatterns
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

module.exports = router;
