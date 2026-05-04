const express = require("express");
const requireDb = require("../middleware/requireDb");
const { runLearningCycle } = require("../services/learner");

const router = express.Router();

router.post("/", requireDb, async (req, res, next) => {
  try {
    const { engagementId } = req.body;
    if (!engagementId || typeof engagementId !== "string") {
      return res.status(400).json({
        error: "engagementId is required"
      });
    }

    const result = await runLearningCycle(engagementId);
    if (result.error === "Engagement not found") {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    return res.status(200).json(result);
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

