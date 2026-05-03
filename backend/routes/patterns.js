const express = require("express");
const Pattern = require("../models/Pattern");
const Engagement = require("../models/Engagement");
const requireDb = require("../middleware/requireDb");
const {
  computeSuccessRate,
  scorePatternForEngagement
} = require("../services/patternEngine");

const router = express.Router();

router.post("/", requireDb, async (req, res, next) => {
  try {
    if (!req.body.name || typeof req.body.name !== "string") {
      return res.status(400).json({
        error: "name is required"
      });
    }

    const successCount = Number(req.body.successCount || 0);
    const failureCount = Number(req.body.failureCount || 0);

    if (successCount < 0 || failureCount < 0) {
      return res.status(400).json({
        error: "successCount and failureCount must be non-negative"
      });
    }

    const pattern = await Pattern.create({
      name: req.body.name.trim(),
      description: req.body.description || "",
      targetType: req.body.targetType || "website",
      successCount,
      failureCount,
      successRate: computeSuccessRate(successCount, failureCount),
      confidence: Number(req.body.confidence || 0),
      recentOutcomes: [],
      recentSuccessRate: 0,
      generalizationScore: Number(req.body.generalizationScore || 0.5),
      tags: Array.isArray(req.body.tags) ? req.body.tags : []
    });

    return res.status(201).json(pattern);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        error: "Pattern with this name already exists"
      });
    }
    return next(error);
  }
});

router.get("/match", requireDb, async (req, res, next) => {
  try {
    const { engagementId } = req.query;
    if (!engagementId || typeof engagementId !== "string") {
      return res.status(400).json({
        error: "engagementId query param is required"
      });
    }

    const engagement = await Engagement.findById(engagementId).lean();
    if (!engagement) {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const patterns = await Pattern.find()
      .sort({ successRate: -1, recentSuccessRate: -1, updatedAt: -1 })
      .limit(200)
      .lean();

    const ranked = patterns
      .map((pattern) => scorePatternForEngagement(pattern, engagement))
      .sort((left, right) => right.applicabilityScore - left.applicabilityScore)
      .slice(0, limit);

    return res.status(200).json({
      engagementId: engagement._id,
      targetType: engagement.targetType,
      targetUrl: engagement.targetUrl,
      rankedPatterns: ranked
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

router.get("/", requireDb, async (_req, res, next) => {
  try {
    const patterns = await Pattern.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.status(200).json(patterns);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
