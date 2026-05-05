const express = require("express");
const requireDb = require("../middleware/requireDb");
const {
  runResearchCycle,
  getLatestResearchLog,
  listResearchLogs
} = require("../services/researchEngine");

const router = express.Router();

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function writeFailureResearchLog({
  startedAt,
  createdBy,
  trigger,
  sourceFilter,
  errors
}) {
  const ResearchLog = require("../models/ResearchLog");
  const completedAt = new Date();
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  const normalizedErrors =
    Array.isArray(errors) && errors.length > 0
      ? errors.map((item) => String(item))
      : ["FATAL: Research cycle failed before completion."];

  try {
    await ResearchLog.create({
      trigger,
      startedAt,
      completedAt,
      durationMs,
      sourcesChecked: Array.isArray(sourceFilter) ? sourceFilter.length : 0,
      newPatternsCreated: 0,
      promptEvolutionTriggered: false,
      summary: "Research cycle failed before completion.",
      sourceResults: [],
      errors: normalizedErrors,
      createdBy
    });
  } catch (logError) {
    console.error("[Research] Log write failed:", logError.message);
  }
}

router.get("/latest", requireDb, async (_req, res, next) => {
  try {
    const latest = await getLatestResearchLog();
    return res.status(200).json({
      latest: latest || null
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/log", requireDb, async (req, res, next) => {
  try {
    const limit = toInteger(req.query.limit, 20);
    const logs = await listResearchLogs(limit);
    return res.status(200).json({
      count: logs.length,
      logs
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/trigger", requireDb, async (req, res, next) => {
  try {
    const sourceFilter = Array.isArray(req.body?.sourceFilter)
      ? req.body.sourceFilter.map((item) => String(item))
      : [];
    const createdBy = req.user?.id || "unknown";
    const runInBackground = req.body?.background === true;
    if (runInBackground) {
      setImmediate(async () => {
        const startedAt = new Date();
        let result = {
          runId: null,
          sourcesChecked: 0,
          newPatternsCreated: 0,
          updatedPatterns: 0,
          promptEvolutionTriggered: false,
          summary: "Research cycle failed before completion.",
          sourceResults: [],
          errors: [],
          runAt: startedAt
        };
        try {
          result = await runResearchCycle({
            trigger: "manual",
            createdBy,
            sourceFilter
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown research failure";
          result.errors = [...result.errors, `FATAL: ${message}`];
          console.error("[Research] Manual trigger failed:", message, error?.stack || "");
        } finally {
          if (!result?.runId) {
            await writeFailureResearchLog({
              startedAt,
              createdBy,
              trigger: "manual",
              sourceFilter,
              errors: result.errors
            });
          }
        }
      });

      return res.status(202).json({
        status: "triggered",
        message: "Research cycle started in background."
      });
    }

    const startedAt = new Date();
    try {
      const result = await runResearchCycle({
        trigger: "manual",
        createdBy,
        sourceFilter
      });
      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown research failure";
      await writeFailureResearchLog({
        startedAt,
        createdBy,
        trigger: "manual",
        sourceFilter,
        errors: [`FATAL: ${message}`]
      });
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
