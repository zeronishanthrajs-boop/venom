const express = require("express");
const requireDb = require("../middleware/requireDb");
const {
  evolvePrompts,
  getPromptHistory
} = require("../services/promptEvolver");

const router = express.Router();

router.post("/prompts", requireDb, async (req, res, next) => {
  try {
    const promptTypes = Array.isArray(req.body?.promptTypes)
      ? req.body.promptTypes.map((item) => String(item))
      : undefined;
    const createdBy = req.user?.id || "unknown";
    const waitForCompletion = req.body?.waitForCompletion === true;

    if (waitForCompletion) {
      const result = await evolvePrompts({
        promptTypes,
        createdBy
      });
      return res.status(200).json(result);
    }

    setImmediate(async () => {
      try {
        await evolvePrompts({
          promptTypes,
          createdBy
        });
      } catch (error) {
        console.error("[PromptEvolver] Manual trigger failed:", error.message);
      }
    });

    return res.status(202).json({
      status: "triggered",
      message: "Prompt evolution started in background."
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/prompts/history", requireDb, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const promptType = req.query.promptType ? String(req.query.promptType) : undefined;
    const versions = await getPromptHistory({ promptType, limit });
    return res.status(200).json({
      versions
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
