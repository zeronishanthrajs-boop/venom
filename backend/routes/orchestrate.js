const express = require("express");
const requireDb = require("../middleware/requireDb");
const {
  orchestrateSingle,
  orchestrateMultiple,
  getOrchestratorStatus
} = require("../services/orchestrator");

const router = express.Router();

router.get("/status", requireDb, (_req, res) => {
  return res.status(200).json(getOrchestratorStatus());
});

router.post("/", requireDb, async (req, res, next) => {
  try {
    const { engagementIds } = req.body || {};
    const result = await orchestrateMultiple(
      Array.isArray(engagementIds) ? engagementIds : [],
      req.user?.id || "unknown"
    );
    return res.status(200).json(result);
  } catch (error) {
    if (Number.isInteger(error?.httpStatus) && typeof error?.message === "string") {
      return res.status(error.httpStatus).json({
        error: error.message
      });
    }
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

router.post("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const result = await orchestrateSingle(
      String(req.params.engagementId || ""),
      req.user?.id || "unknown"
    );
    return res.status(200).json(result);
  } catch (error) {
    if (Number.isInteger(error?.httpStatus) && typeof error?.message === "string") {
      return res.status(error.httpStatus).json({
        error: error.message
      });
    }
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

module.exports = router;
