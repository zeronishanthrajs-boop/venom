const express = require("express");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const { listTools } = require("../tooling/toolRegistry");
const { executeEngagementTool } = require("../services/executionService");

const router = express.Router();

router.get("/tools", (_req, res) => {
  return res.status(200).json(listTools());
});

router.post("/", requireDb, async (req, res, next) => {
  try {
    const result = await executeEngagementTool({
      engagementId: req.body.engagementId,
      toolId: req.body.toolId,
      requestedTargetUrl: req.body.targetUrl,
      userId: req.user?.id || "unknown"
    });

    return res.status(result.httpStatus).json(result.job);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    if (Number.isInteger(error?.httpStatus) && typeof error?.message === "string") {
      return res.status(error.httpStatus).json({ error: error.message });
    }
    return next(error);
  }
});

router.get("/engagement/:engagementId", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find({
      engagementId: req.params.engagementId
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.status(200).json(jobs);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

router.get("/:id", requireDb, async (req, res, next) => {
  try {
    const job = await ExecutionJob.findById(req.params.id).lean();
    if (!job) {
      return res.status(404).json({ error: "Execution job not found" });
    }
    return res.status(200).json(job);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid execution job id"
      });
    }
    return next(error);
  }
});

module.exports = router;
