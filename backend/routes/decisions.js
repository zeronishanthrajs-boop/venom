const express = require("express");
const requireDb = require("../middleware/requireDb");
const {
  generateDecisionBrief,
  getLatestDecisionBrief
} = require("../services/decisionEngine");

const router = express.Router();

router.post("/:engagementId/brief", requireDb, async (req, res, next) => {
  try {
    const brief = await generateDecisionBrief(req.params.engagementId);
    return res.status(200).json(brief);
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

router.get("/:engagementId/brief", requireDb, async (req, res, next) => {
  try {
    const shouldGenerate =
      String(req.query.generate || "").toLowerCase() === "true";
    let brief = await getLatestDecisionBrief(req.params.engagementId);
    if (!brief && shouldGenerate) {
      brief = await generateDecisionBrief(req.params.engagementId);
    }

    if (!brief) {
      return res.status(404).json({
        error: "No brief yet. POST to generate or call GET with ?generate=true"
      });
    }

    return res.status(200).json(brief);
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

module.exports = router;

