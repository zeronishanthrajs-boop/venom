const express = require("express");
const Engagement = require("../models/Engagement");
const Plan = require("../models/Plan");
const requireDb = require("../middleware/requireDb");
const { generatePlanForEngagement } = require("../services/planner");

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

    if (typeof error?.message === "string" && /Claude API request failed/i.test(error.message)) {
      return res.status(502).json({
        error: "Planner upstream (Claude API) unavailable",
        details: error.message
      });
    }

    if (typeof error?.message === "string" && /Claude JSON repair failed/i.test(error.message)) {
      return res.status(502).json({
        error: "Planner JSON normalization upstream unavailable",
        details: error.message
      });
    }

    return next(error);
  }
});

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
