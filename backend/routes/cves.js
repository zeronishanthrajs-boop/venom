const express = require("express");
const CveSnapshot = require("../models/CveSnapshot");
const requireDb = require("../middleware/requireDb");
const { syncRecentCves } = require("../services/cveIngester");

const router = express.Router();

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.post("/sync", requireDb, async (req, res, next) => {
  try {
    const result = await syncRecentCves({
      limit: req.body?.limit,
      sinceDays: req.body?.sinceDays,
      severity: req.body?.severity,
      keywordSearch: req.body?.keywordSearch
    });

    return res.status(200).json({
      ok: true,
      ...result,
      syncedAt: new Date().toISOString()
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/", requireDb, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const severityFilter = String(req.query.severity || "").toUpperCase();
    const tag = String(req.query.tag || "").trim().toLowerCase();
    const keyword = String(req.query.keyword || "").trim();

    const query = {};
    if (severityFilter) {
      query.cvssSeverity = severityFilter;
    }
    if (tag) {
      query.applicabilityTags = tag;
    }
    if (keyword) {
      const safePattern = new RegExp(escapeRegExp(keyword), "i");
      query.$or = [
        { cveId: safePattern },
        { description: safePattern },
        { cweIds: safePattern },
        { applicabilityTags: safePattern },
        { affectedProducts: safePattern }
      ];
    }

    const cves = await CveSnapshot.find(query)
      .sort({ venomRelevanceScore: -1, publishedAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      count: cves.length,
      cves
    });
  } catch (error) {
    return next(error);
  }
});

async function buildStatsPayload() {
  const [total, critical, high, medium, withExploit, latest] = await Promise.all([
    CveSnapshot.countDocuments({}),
    CveSnapshot.countDocuments({ cvssSeverity: "CRITICAL" }),
    CveSnapshot.countDocuments({ cvssSeverity: "HIGH" }),
    CveSnapshot.countDocuments({ cvssSeverity: "MEDIUM" }),
    CveSnapshot.countDocuments({ exploitAvailable: true }),
    CveSnapshot.findOne({}).sort({ updatedAt: -1 }).lean()
  ]);

  return {
    total,
    critical,
    high,
    medium,
    withExploit,
    bySeverity: {
      critical,
      high,
      medium
    },
    lastUpdatedAt: latest?.updatedAt || null
  };
}

router.get("/stats", requireDb, async (_req, res, next) => {
  try {
    const payload = await buildStatsPayload();
    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get("/summary", requireDb, async (_req, res, next) => {
  try {
    const payload = await buildStatsPayload();
    return res.status(200).json(payload);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
