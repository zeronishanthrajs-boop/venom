const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const secretsDetectionService = require("../services/secretsDetectionService");
const { logger } = require("../config/logger");

const router = express.Router();

function toExecutionFinding(finding = {}, index = 0) {
  return {
    id: finding.id || `secret-${index + 1}`,
    severity: finding.severity || "critical",
    category: finding.category || "Secrets Exposure",
    title: finding.title || "Potential secret exposure detected",
    description: finding.description || "Potential exposed secret detected during scan.",
    recommendation:
      finding.recommendation ||
      finding.remediation ||
      "Rotate exposed credential and move secrets to secure storage.",
    source: finding.source || "secrets_detection",
    tags: Array.isArray(finding.tags) ? finding.tags : ["secrets"],
    metadata: finding.metadata || {}
  };
}

router.post("/scan/:engagementId", requireDb, async (req, res, next) => {
  try {
    const { engagementId } = req.params;
    const engagement = await Engagement.findById(engagementId).lean();
    if (!engagement) {
      return res.status(404).json({ error: "Engagement not found" });
    }

    const startedAt = Date.now();
    logger.info({ engagementId }, "Starting secrets scan route execution");
    const result = await secretsDetectionService.scanEngagement(engagementId);
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const hasError = Boolean(result.error) && findings.length === 0;

    const job = await ExecutionJob.create({
      engagementId: engagement._id,
      toolId: "secrets_scan",
      targetUrl: engagement.targetUrl,
      status: hasError ? "failed" : "success",
      startedAt: new Date(startedAt),
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      output: {
        findings,
        source: "secrets_detection",
        error: result.error || null
      },
      findings: findings.map((finding, index) => toExecutionFinding(finding, index)),
      errorMessage: hasError ? result.error : "",
      createdBy: req.user?.id || "unknown"
    });

    return res.status(200).json({
      message: "Secrets scan complete",
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
      "Secrets scan route failed"
    );
    return next(error);
  }
});

router.get("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find({
      engagementId: req.params.engagementId,
      toolId: "secrets_scan"
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
