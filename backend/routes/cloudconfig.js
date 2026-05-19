const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const cloudMisconfigService = require("../services/cloudMisconfigService");
const { logger } = require("../config/logger");

const router = express.Router();

function buildCredentialsFromRequest(body = {}) {
  return {
    accessKeyId: body.accessKeyId || process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: body.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || "",
    sessionToken: body.sessionToken || process.env.AWS_SESSION_TOKEN || "",
    region: body.region || process.env.AWS_REGION || "us-east-1"
  };
}

function toExecutionFinding(issue = {}, index = 0) {
  return {
    id: issue.id || `cloud-${index + 1}`,
    severity: issue.severity || "high",
    category: issue.category || "Cloud Configuration",
    title: issue.title || "Cloud misconfiguration detected",
    description: issue.description || "Potential cloud misconfiguration detected.",
    recommendation:
      issue.recommendation ||
      issue.remediation ||
      "Apply least privilege and cloud hardening controls.",
    source: issue.source || "cloud_misconfiguration",
    tags: Array.isArray(issue.tags) ? issue.tags : ["cloud"],
    metadata: issue.metadata || {}
  };
}

router.post("/scan/:engagementId", requireDb, async (req, res, next) => {
  try {
    const { engagementId } = req.params;
    const engagement = await Engagement.findById(engagementId).lean();
    if (!engagement) {
      return res.status(404).json({ error: "Engagement not found" });
    }

    const credentials = buildCredentialsFromRequest(req.body || {});
    const startedAt = Date.now();
    const findings = await cloudMisconfigService.scanAWSAccount(credentials);

    const job = await ExecutionJob.create({
      engagementId: engagement._id,
      toolId: "cloud_misconfig_scan",
      targetUrl: engagement.targetUrl,
      status: "success",
      startedAt: new Date(startedAt),
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      output: {
        findings,
        source: "cloud_misconfiguration",
        scannedRegion: credentials.region
      },
      findings: findings.map((finding, index) => toExecutionFinding(finding, index)),
      createdBy: req.user?.id || "unknown"
    });

    return res.status(200).json({
      message: "Cloud misconfiguration scan complete",
      executionJobId: String(job._id),
      count: findings.length,
      findings
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    logger.error(
      { error: error?.message || String(error) },
      "Cloud misconfiguration scan route failed"
    );
    return next(error);
  }
});

router.get("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find({
      engagementId: req.params.engagementId,
      toolId: "cloud_misconfig_scan"
    })
      .sort({ createdAt: -1 })
      .lean();

    const findings = jobs.flatMap((job) => {
      if (Array.isArray(job.findings) && job.findings.length > 0) {
        return job.findings;
      }
      return Array.isArray(job.output?.findings) ? job.output.findings : [];
    });

    return res.status(200).json({
      count: findings.length,
      critical: findings.filter((item) => String(item.severity).toLowerCase() === "critical")
        .length,
      high: findings.filter((item) => String(item.severity).toLowerCase() === "high").length,
      findings
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    return next(error);
  }
});

module.exports = router;
