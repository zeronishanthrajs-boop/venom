const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const supplyChainService = require("../services/supplyChainService");
const executionLoggerService = require("../services/executionLoggerService");
const { logger } = require("../config/logger");

const router = express.Router();

function buildExecutionMeta() {
  return {
    testId: `test-supply-chain-scan-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    testName: "Supply Chain Dependency Scan",
    category: "Supply Chain",
    tool: "supply_chain_scan"
  };
}

function toExecutionFinding(finding = {}, index = 0, executionMeta = null, targetUrl = "") {
  return {
    id: finding.id || `supply-${index + 1}`,
    severity: finding.severity || "medium",
    category: finding.category || "Supply Chain",
    title: finding.title || "Vulnerable dependency detected",
    description: finding.description || "A vulnerable dependency was detected.",
    recommendation:
      finding.recommendation ||
      finding.remediation ||
      "Upgrade dependency to a patched version.",
    source: finding.source || "supply_chain",
    cve: finding.cve || null,
    cvssScore: Number.isFinite(Number(finding.cvssScore))
      ? Number(finding.cvssScore)
      : null,
    tags: Array.isArray(finding.tags) ? finding.tags : ["supply-chain"],
    metadata: {
      ...(finding.metadata || {}),
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

function resolveJobStatus(result = {}, findings = []) {
  const status = String(result.status || "").toUpperCase();
  if (status === "NOT_APPLICABLE") {
    return "not_applicable";
  }
  if (status === "TOOL_NOT_INSTALLED") {
    return "tool_not_installed";
  }
  if (status === "ERROR" || (result.error && findings.length === 0)) {
    return "failed";
  }
  return "success";
}

function resolveFailureMessage(result = {}) {
  return result.failureReason || result.error || result.message || result.reason || "";
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
    const result = await supplyChainService.scanEngagement(engagementId, engagement.targetUrl);
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const normalizedFindings = findings.map((finding, index) =>
      toExecutionFinding(finding, index, executionMeta, engagement.targetUrl)
    );
    const jobStatus = resolveJobStatus(result, normalizedFindings);

    const job = await ExecutionJob.create({
      engagementId: engagement._id,
      toolId: "supply_chain_scan",
      targetUrl: engagement.targetUrl,
      status: jobStatus,
      startedAt: new Date(startedAt),
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      output: {
        findings: normalizedFindings,
        source: "supply_chain",
        status: result.status || "SUCCESS",
        vulnerabilities: result.vulnerabilities || [],
        attemptedFiles: result.attemptedFiles || [],
        filesFound: result.filesFound || [],
        reason: result.reason || "",
        failureReason: result.failureReason || "",
        errorCode: result.errorCode || "",
        error: result.error || null
      },
      findings: normalizedFindings,
      errorMessage: jobStatus === "failed" ? resolveFailureMessage(result) : "",
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
        endpoint: "/api/supplychain/scan/:engagementId",
        dependencySource: "package_manifest",
        attemptedFiles: result.attemptedFiles || [],
        filesFound: result.filesFound || []
      },
      job: job.toObject(),
      meta: {
        trigger: "route"
      }
    });

    return res.status(200).json({
      message: "Supply-chain scan complete",
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
      { error: error?.message || String(error), stack: error?.stack || "" },
      "Supply-chain scan route failed"
    );
    return next(error);
  }
});

router.get("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find({
      engagementId: req.params.engagementId,
      toolId: "supply_chain_scan"
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
