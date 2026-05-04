const express = require("express");
const mongoose = require("mongoose");
const Engagement = require("../models/Engagement");
const ActivityLog = require("../models/ActivityLog");
const requireDb = require("../middleware/requireDb");
const {
  getScopeDashboard,
  previewEngagementActions,
  getKillSwitchState,
  setGlobalKillSwitch,
  setEngagementKillSwitch
} = require("../services/trustControl");

const router = express.Router();

router.get("/scope/:engagementId", requireDb, async (req, res, next) => {
  try {
    const engagement = await Engagement.findById(req.params.engagementId).lean();
    if (!engagement) {
      return res.status(404).json({ error: "Engagement not found" });
    }
    return res.status(200).json(getScopeDashboard(engagement));
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    return next(error);
  }
});

router.get("/preview/:engagementId", requireDb, async (req, res, next) => {
  try {
    const engagement = await Engagement.findById(req.params.engagementId).lean();
    if (!engagement) {
      return res.status(404).json({ error: "Engagement not found" });
    }

    return res.status(200).json({
      engagementId: String(engagement._id),
      targetUrl: engagement.targetUrl,
      actions: previewEngagementActions(engagement)
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    return next(error);
  }
});

router.get("/killswitch", requireDb, async (req, res, next) => {
  try {
    const engagementId = req.query.engagementId;
    if (engagementId && !mongoose.isValidObjectId(engagementId)) {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    const state = await getKillSwitchState(engagementId || null);
    return res.status(200).json(state);
  } catch (error) {
    return next(error);
  }
});

router.post("/killswitch/global", requireDb, async (req, res, next) => {
  try {
    const state = await setGlobalKillSwitch(
      req.body?.active,
      req.body?.reason,
      req.user?.id || "unknown"
    );
    return res.status(200).json(state);
  } catch (error) {
    return next(error);
  }
});

router.post("/killswitch/engagement/:engagementId", requireDb, async (req, res, next) => {
  try {
    const engagement = await Engagement.findById(req.params.engagementId).lean();
    if (!engagement) {
      return res.status(404).json({ error: "Engagement not found" });
    }

    const state = await setEngagementKillSwitch(
      engagement._id,
      req.body?.active,
      req.body?.reason,
      req.user?.id || "unknown"
    );
    return res.status(200).json(state);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    return next(error);
  }
});

router.get("/activity/recent", requireDb, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const logs = await ActivityLog.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.status(200).json({
      count: logs.length,
      logs
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
