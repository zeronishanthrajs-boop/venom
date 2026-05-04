const express = require("express");
const requireDb = require("../middleware/requireDb");
const SecurityBaseline = require("../models/SecurityBaseline");
const { createSnapshot, detectChanges } = require("../services/changeDetector");

const router = express.Router();

router.get("/:engagementId/snapshots", requireDb, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const snapshots = await SecurityBaseline.find({
      engagementId: req.params.engagementId
    })
      .sort({ snapshotAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();
    return res.status(200).json(snapshots);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    return next(error);
  }
});

router.post("/:engagementId/snapshot", requireDb, async (req, res, next) => {
  try {
    const snapshotType = String(req.body?.snapshotType || "manual");
    const snapshot = await createSnapshot(
      req.params.engagementId,
      snapshotType,
      req.user?.id || "unknown"
    );
    return res.status(201).json(snapshot);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    if (error?.code === "ENGAGEMENT_NOT_FOUND") {
      return res.status(404).json({ error: "Engagement not found" });
    }
    return next(error);
  }
});

router.get("/:engagementId/changes", requireDb, async (req, res, next) => {
  try {
    const delta = await detectChanges(req.params.engagementId);
    return res.status(200).json(delta);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    return next(error);
  }
});

module.exports = router;

