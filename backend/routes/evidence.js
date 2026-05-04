const express = require("express");
const requireDb = require("../middleware/requireDb");
const Evidence = require("../models/Evidence");

const router = express.Router();

router.get("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const records = await Evidence.find({
      engagementId: req.params.engagementId
    })
      .sort({ chainIndex: -1 })
      .limit(limit)
      .lean();
    return res.status(200).json(records);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

router.get("/:engagementId/verify", requireDb, async (req, res, next) => {
  try {
    const verification = await Evidence.verifyChain(req.params.engagementId);
    return res.status(200).json({
      engagementId: req.params.engagementId,
      ...verification,
      verifiedAt: new Date().toISOString()
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

module.exports = router;
