const express = require("express");
const requireDb = require("../middleware/requireDb");
const { logger } = require("../config/logger");
const {
  orchestrateSingle,
  orchestrateMultiple,
  getOrchestratorStatus
} = require("../services/orchestrator");

const router = express.Router();

function isTruthy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

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
    const engagementId = String(req.params.engagementId || "").trim();
    if (!engagementId) {
      return res.status(400).json({
        error: "engagementId is required"
      });
    }

    const asyncMode = isTruthy(req.query?.async) || isTruthy(req.body?.async);
    const userId = req.user?.id || "unknown";

    if (asyncMode) {
      setImmediate(async () => {
        try {
          await orchestrateSingle(engagementId, userId);
        } catch (error) {
          logger.error(
            { engagementId, userId, error: error?.message || "unknown error" },
            "Async orchestration failed"
          );
        }
      });

      return res.status(202).json({
        engagementId,
        status: "scheduled",
        mode: "async"
      });
    }

    const result = await orchestrateSingle(
      engagementId,
      userId
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
