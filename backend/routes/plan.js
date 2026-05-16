const express = require("express");
const Engagement = require("../models/Engagement");
const Plan = require("../models/Plan");
const requireDb = require("../middleware/requireDb");
const { generatePlanForEngagement } = require("../services/planner");
const { logger } = require("../config/logger");

const router = express.Router();

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

    if (
      engagement.authorization?.validUntil &&
      new Date(engagement.authorization.validUntil) < new Date()
    ) {
      return res.status(403).json({
        error: "Cannot generate plan for expired authorization"
      });
    }

    const result = await generatePlanForEngagement(engagement);

    const savedPlan = await Plan.create({
      engagementId: engagement._id,
      promptVersion: result.promptVersion,
      plannerSource: result.source,
      model: result.model,
      fallbackReason: result.fallbackReason || "",
      rationale: result.rationale || "",
      confidence:
        Number.isFinite(Number(result.confidence)) ? Number(result.confidence) : 0.5,
      learnedPatterns: Array.isArray(result.learnedPatterns)
        ? result.learnedPatterns
        : [],
      learnedRecommendations: Array.isArray(result.learnedRecommendations)
        ? result.learnedRecommendations
        : [],
      summary: result.plan.summary,
      phases: result.plan.phases,
      riskNotes: result.plan.riskNotes,
      disclaimers: result.plan.disclaimers,
      inputSnapshot: {
        targetUrl: engagement.targetUrl,
        targetType: engagement.targetType,
        scope: engagement.scope,
        constraints: engagement.constraints,
        authorization: engagement.authorization
      },
      rawModelOutput: result.rawModelOutput,
      createdBy: req.user?.id || "unknown"
    });

    return res.status(201).json(savedPlan);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }

    if (typeof error?.message === "string" && /Gemini API request failed/i.test(error.message)) {
      return res.status(502).json({
        error: "Planner upstream (Gemini API) unavailable",
        details: error.message
      });
    }

    if (typeof error?.message === "string" && /Gemini JSON repair failed/i.test(error.message)) {
      return res.status(502).json({
        error: "Planner JSON normalization upstream unavailable",
        details: error.message
      });
    }

    return next(error);
  }
});

async function handlePlanExplain(req, res, next) {
  try {
    const plan = await Plan.findOne({
      engagementId: req.params.engagementId
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!plan) {
      return res.status(404).json({
        error: "Plan not found"
      });
    }

    const learnedPatterns = Array.isArray(plan.learnedPatterns)
      ? plan.learnedPatterns
      : [];
    const learnedRecommendations = Array.isArray(plan.learnedRecommendations)
      ? plan.learnedRecommendations
      : [];

    return res.status(200).json({
      engagementId: req.params.engagementId,
      plan: learnedRecommendations.map((item) => ({
        condition: item.condition || "",
        tool: item.tool || "",
        paramAdjustment:
          item.paramAdjustment && typeof item.paramAdjustment === "object"
            ? item.paramAdjustment
            : {},
        expectedSuccess: Number(
          Number.isFinite(Number(item.expectedSuccess))
            ? Number(item.expectedSuccess)
            : 0
        )
      })),
      explanation:
        plan.rationale ||
        (learnedPatterns.length > 0
          ? `Planner applied ${learnedPatterns.length} learned pattern(s).`
          : "No learned patterns were available for this engagement."),
      learnedPatterns,
      confidence:
        Number.isFinite(Number(plan.confidence)) ? Number(plan.confidence) : 0.5
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    logger.error(
      { error: error?.message || "unknown error" },
      "Failed to explain plan"
    );
    return next(error);
  }
}

router.get("/:engagementId/explain", requireDb, handlePlanExplain);
router.get("/engagement/:engagementId/explain", requireDb, handlePlanExplain);

router.get("/engagement/:engagementId", requireDb, async (req, res, next) => {
  try {
    const plans = await Plan.find({
      engagementId: req.params.engagementId
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.status(200).json(plans);
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
