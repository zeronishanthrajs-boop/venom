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
        try {
          await runResearchCycle({
            trigger: "manual",
            createdBy,
            sourceFilter
          });
        } catch (error) {
          console.error("[Research] Manual trigger failed:", error.message);
        }
      });

      return res.status(202).json({
        status: "triggered",
        message: "Research cycle started in background."
      });
    }

    const result = await runResearchCycle({
      trigger: "manual",
      createdBy,
      sourceFilter
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
