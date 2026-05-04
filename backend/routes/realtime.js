const express = require("express");
const { issueRealtimeToken, getRealtimeStatus } = require("../services/realtimeServer");

const router = express.Router();

router.get("/token", (req, res) => {
  const engagementId = req.query.engagementId
    ? String(req.query.engagementId)
    : null;
  const token = issueRealtimeToken({
    userId: req.user?.id || "unknown",
    role: req.user?.role || "operator",
    engagementId
  });

  return res.status(200).json({
    token,
    engagementId,
    wsPath: "/ws",
    expiresInMs: Math.max(
      Number.parseInt(String(process.env.VENOM_REALTIME_TOKEN_TTL_MS || "600000"), 10) ||
        600000,
      60000
    )
  });
});

router.get("/status", (_req, res) => {
  return res.status(200).json(getRealtimeStatus());
});

module.exports = router;

