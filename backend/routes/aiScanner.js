const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const aiAppScannerService = require("../services/aiAppScannerService");
const executionLoggerService = require("../services/executionLoggerService");
const { logger } = require("../config/logger");

const router = express.Router();

function buildExecutionMeta() {
  return {
    testId: `test-ai-scan-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    testName: "AI-App Security Scan",
    category: "AI & LLM Security",
    tool: "ai_app_scan"
  };
}

function toExecutionFinding(finding = {}, index = 0, executionMeta = null, targetUrl = "") {
  const type = finding.type || "AI_VULNERABILITY";
  return {
    id: finding.id || `ai-${index + 1}`,
    type,
    severity: finding.severity || "medium",
    category: finding.category || "AI & LLM Security",
    title: finding.title || "AI App Vulnerability",
    description: finding.description || "Potential security vulnerability in AI App integration.",
    recommendation: finding.recommendation || "Verify inputs, apply authentication, and set up strict guardrails.",
    source: finding.source || "ai_scanner",
    tags: Array.isArray(finding.tags) ? finding.tags : ["ai"],
    evidence: finding.evidence || "",
    metadata: {
      ...(finding.metadata || {}),
      type,
      ...(executionMeta
        ? {
            executionTestId: executionMeta.testId,
            testId: executionMeta.testId,
            executionTestName: executionMeta.testName
          }
        : {}),
      ...(targetUrl ? { targetUrl } : {})
    }
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
    const executionMeta = buildExecutionMeta();
    logger.info({ engagementId }, "Starting AI scan route execution");
    const result = await aiAppScannerService.scanEngagement(engagementId);
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const normalizedFindings = findings.map((finding, index) =>
      toExecutionFinding(finding, index, executionMeta, engagement.targetUrl)
    );
    const hasError = Boolean(result.error) && findings.length === 0;

    const job = await ExecutionJob.create({
      engagementId: engagement._id,
      toolId: "ai_app_scan",
      targetUrl: engagement.targetUrl,
      status: hasError ? "failed" : "success",
      startedAt: new Date(startedAt),
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      output: {
        findings: normalizedFindings,
        source: "ai_app_scanner",
        error: result.error || null
      },
      findings: normalizedFindings,
      errorMessage: hasError ? result.error : "",
      createdBy: req.user?.id || "unknown"
    });

    await executionLoggerService.logExecutionJob({
      engagementId: String(engagement._id),
      testId: executionMeta.testId,
      testName: executionMeta.testName,
      tool: executionMeta.tool,
      category: executionMeta.category,
      target: engagement.targetUrl,
      parameters: {
        mode: "manual-route",
        endpoint: "/api/aiscan/scan/:engagementId"
      },
      job: job.toObject(),
      meta: {
        trigger: "route"
      }
    });

    return res.status(200).json({
      message: "AI scan complete",
      executionJobId: String(job._id),
      testId: executionMeta.testId,
      count: normalizedFindings.length,
      findings: normalizedFindings
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    logger.error(
      { error: error?.message || String(error) },
      "AI scan route failed"
    );
    return next(error);
  }
});

router.get("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find({
      engagementId: req.params.engagementId,
      toolId: "ai_app_scan"
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
