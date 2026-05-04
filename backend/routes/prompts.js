const express = require("express");
const requireDb = require("../middleware/requireDb");
const {
  SUPPORTED_PROMPT_TYPES,
  evolvePrompts,
  getPromptHistory,
  getActivePrompts
} = require("../services/promptEvolver");
const { runEvolutionCycle } = require("../jobs/evolutionJob");

const router = express.Router();

router.get("/active", requireDb, async (_req, res, next) => {
  try {
    const active = await getActivePrompts();
    return res.status(200).json({
      promptTypesSupported: SUPPORTED_PROMPT_TYPES,
      active
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/history", requireDb, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const promptType = req.query.promptType ? String(req.query.promptType) : undefined;
    const history = await getPromptHistory({ promptType, limit });
    return res.status(200).json({
      count: history.length,
      history
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/evolve", requireDb, async (req, res, next) => {
  try {
    const promptTypes = Array.isArray(req.body?.promptTypes)
      ? req.body.promptTypes.map((item) => String(item))
      : undefined;

    const result = await evolvePrompts({
      promptTypes,
      createdBy: req.user?.id || "unknown"
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/evolve/run", requireDb, async (_req, res, next) => {
  try {
    const result = await runEvolutionCycle("manual", {
      createdBy: _req.user?.id || "unknown"
    });
    return res.status(result.ok === false ? 500 : 200).json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
