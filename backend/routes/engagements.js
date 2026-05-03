const express = require("express");
const Engagement = require("../models/Engagement");
const engagementConstraints = require("../middleware/engagementConstraints");
const requireDb = require("../middleware/requireDb");

const router = express.Router();

function toEngagementPayload(body, userId) {
  return {
    name: body.name,
    description: body.description || "",
    targetUrl: body.targetUrl,
    targetType: body.targetType || "website",
    scope: {
      allowedDomains: body.scope?.allowedDomains || [],
      allowedIpRanges: body.scope?.allowedIpRanges || [],
      restrictedPaths: body.scope?.restrictedPaths || [],
      restrictedServices: body.scope?.restrictedServices || []
    },
    authorization: {
      engagementId: body.authorization?.engagementId || "",
      authorizedBy: body.authorization?.authorizedBy || "",
      validFrom: body.authorization?.validFrom || new Date().toISOString(),
      validUntil: body.authorization?.validUntil,
      scopeOfWork: body.authorization?.scopeOfWork || ""
    },
    constraints: {
      toolWhitelist: body.constraints?.toolWhitelist || [],
      noDestructiveOps:
        body.constraints?.noDestructiveOps === undefined
          ? true
          : Boolean(body.constraints?.noDestructiveOps),
      quietMode: Boolean(body.constraints?.quietMode),
      maxConcurrentOps: body.constraints?.maxConcurrentOps || 1,
      timeoutMinutes: body.constraints?.timeoutMinutes || 60
    },
    status: body.status || "draft",
    createdBy: userId
  };
}

router.post("/", engagementConstraints, requireDb, async (req, res, next) => {
  try {
    if (!req.body.name || typeof req.body.name !== "string") {
      return res.status(400).json({
        error: "name is required"
      });
    }

    const engagement = await Engagement.create(
      toEngagementPayload(req.body, req.user?.id || "unknown")
    );
    return res.status(201).json(engagement);
  } catch (error) {
    return next(error);
  }
});

router.get("/", requireDb, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const engagements = await Engagement.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json(engagements);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", requireDb, async (req, res, next) => {
  try {
    const engagement = await Engagement.findById(req.params.id).lean();
    if (!engagement) {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    return res.status(200).json(engagement);
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
