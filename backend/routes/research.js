const router = require("express").Router();
const requireDb = require("../middleware/requireDb");
const Pattern = require("../models/Pattern");
const ResearchLog = require("../models/ResearchLog");
const {
  runResearchCycle,
  getLatestResearchLog,
  listResearchLogs
} = require("../services/researchEngine");

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function writeFallbackLog({
  trigger = "manual",
  createdBy = "system",
  startedAt = new Date(),
  errors = [],
  sourceResults = [],
  sourcesChecked = 0,
  newPatternsCreated = 0,
  promptEvolutionTriggered = false
}) {
  const completedAt = new Date();
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  const normalizedErrors =
    Array.isArray(errors) && errors.length > 0
      ? errors.map((item) => String(item))
      : ["FATAL: Research cycle failed before completion."];

  await ResearchLog.create({
    trigger,
    startedAt,
    completedAt,
    durationMs,
    sourcesChecked,
    newPatternsCreated,
    promptEvolutionTriggered,
    summary: "Research cycle failed before completion.",
    sourceResults: Array.isArray(sourceResults) ? sourceResults : [],
    errors: normalizedErrors,
    createdBy
  });
}

router.post("/trigger", requireDb, async (req, res) => {
  const sourceFilter = Array.isArray(req.body?.sourceFilter)
    ? req.body.sourceFilter.map((item) => String(item))
    : [];
  const createdBy = req.user?.id || "unknown";

  res.status(200).json({
    status: "triggered",
    message: "Research cycle started. Check /api/research/log in ~60 seconds."
  });

  setImmediate(async () => {
    const startedAt = new Date();
    let result = {
      runId: null,
      sourcesChecked: 0,
      sourcesSucceeded: 0,
      newTechniquesFound: 0,
      newPatternsCreated: 0,
      updatedPatterns: 0,
      promptEvolutionTriggered: false,
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
      result.runAt = startedAt;
    } catch (err) {
      result.errors.push(`FATAL: ${err.message}\n${err.stack || ""}`);
      console.error("[Research] Cycle crashed:", err.message);
    }

    if (result?.runId) {
      return;
    }

    try {
      await writeFallbackLog({
        trigger: "manual",
        createdBy,
        startedAt,
        errors: result.errors,
        sourceResults: result.sourceResults,
        sourcesChecked: result.sourcesChecked,
        newPatternsCreated: result.newPatternsCreated || result.newTechniquesFound || 0,
        promptEvolutionTriggered: Boolean(result.promptEvolutionTriggered)
      });
      console.log("[Research] Fallback log written successfully.");
    } catch (logErr) {
      console.error("[Research] Log write failed:", logErr.message);
    }
  });
});

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

router.get("/log", requireDb, async (req, res) => {
  try {
    const limit = toInteger(req.query.limit, 20);
    const logs = await listResearchLogs(limit);
    const totalResearchPatterns = await Pattern.countDocuments({
      source: { $regex: /^research-/i }
    });

    return res.status(200).json({
      count: logs.length,
      totalResearchPatterns,
      logs
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
