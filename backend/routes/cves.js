const express = require("express");
const CveSnapshot = require("../models/CveSnapshot");
const requireDb = require("../middleware/requireDb");
const { syncRecentCves } = require("../services/cveIngester");

const router = express.Router();

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
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200);
    const severityFilter = String(req.query.severity || "").toUpperCase();
    const keyword = String(req.query.keyword || "").trim();

    const query = {};
    if (severityFilter) {
      query.cvssSeverity = severityFilter;
    }
    if (keyword) {
      query.$or = [
        { cveId: new RegExp(keyword, "i") },
        { description: new RegExp(keyword, "i") },
        { cweIds: new RegExp(keyword, "i") },
        { tags: new RegExp(keyword, "i") }
      ];
    }

    const items = await CveSnapshot.find(query)
      .sort({ publishedAt: -1, cvssScore: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json(items);
  } catch (error) {
    return next(error);
  }
});

router.get("/summary", requireDb, async (_req, res, next) => {
  try {
    const [total, critical, high, medium, latest] = await Promise.all([
      CveSnapshot.countDocuments({}),
      CveSnapshot.countDocuments({ cvssSeverity: "CRITICAL" }),
      CveSnapshot.countDocuments({ cvssSeverity: "HIGH" }),
      CveSnapshot.countDocuments({ cvssSeverity: "MEDIUM" }),
      CveSnapshot.findOne({}).sort({ updatedAt: -1 }).lean()
    ]);

    return res.status(200).json({
      total,
      bySeverity: {
        critical,
        high,
        medium
      },
      lastUpdatedAt: latest?.updatedAt || null
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
