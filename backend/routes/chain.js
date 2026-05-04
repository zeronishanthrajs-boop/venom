const express = require("express");
const requireDb = require("../middleware/requireDb");
const { runExploitationChain } = require("../services/chainEngine");

const router = express.Router();

router.post("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const { engagementId } = req.params;
    if (!engagementId || typeof engagementId !== "string") {
      return res.status(400).json({
        error: "engagementId is required"
      });
    }

    const result = await runExploitationChain({
      engagementId,
      createdBy: req.user?.id || "unknown"
    });

    return res.status(200).json(result);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    if (Number.isInteger(error?.httpStatus) && typeof error?.message === "string") {
      return res.status(error.httpStatus).json({
        error: error.message
      });
    }
    return next(error);
  }
});

module.exports = router;
