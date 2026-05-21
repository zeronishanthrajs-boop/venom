const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const containerSecurityService = require("../services/containerSecurityService");
const executionLoggerService = require("../services/executionLoggerService");
const { logger } = require("../config/logger");

const router = express.Router();

function buildExecutionMeta() {
  return {
    testId: `test-container-security-scan-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    testName: "Container Security Scan",
    category: "Container Security",
    tool: "container_security_scan"
  };
}

function normalizeFindingType(finding = {}) {
  const typeFromMeta = String(finding?.metadata?.findingType || "").trim();
  if (typeFromMeta) {
    return typeFromMeta;
  }
  const explicitType = String(finding?.type || "").trim();
  if (explicitType) {
    return explicitType;
  }
  return "CONTAINER_SECURITY_FINDING";
}

function toExecutionFinding(finding = {}, index = 0, executionMeta = null, targetUrl = "") {
  const findingType = normalizeFindingType(finding);
  return {
    id: finding.id || `container-${index + 1}`,
    severity: finding.severity || "medium",
    category: finding.category || "Container Security",
    title: finding.title || "Container security issue detected",
    description: finding.description || "Container security issue detected during scan.",
    recommendation:
      finding.recommendation ||
      finding.remediation ||
      "Apply container hardening controls and re-run scan.",
    source: finding.source || "container_security",
    cve: finding.cve || null,
    tags: Array.isArray(finding.tags) ? finding.tags : ["container-security"],
    metadata: {
      ...(finding.metadata || {}),
      findingType,
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

function summarizeBySeverity(findings = []) {
  return findings.reduce(
    (acc, finding) => {
      const severity = String(finding?.severity || "low").toLowerCase();
      if (severity in acc) {
        acc[severity] += 1;
      }
      acc.total += 1;
      return acc;
    },
    { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  );
}

function filterContainerFindings(findings = []) {
  return findings.filter((finding) => {
    const findingType = normalizeFindingType(finding);
    return findingType.startsWith("CONTAINER_") || findingType.startsWith("K8S_");
  });
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
    const result = await containerSecurityService.scanEngagement(
      engagementId,
      engagement.targetUrl
    );
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const normalizedFindings = findings.map((finding, index) =>
      toExecutionFinding(finding, index, executionMeta, engagement.targetUrl)
    );
    const jobStatus = resolveJobStatus(result, normalizedFindings);

    const job = await ExecutionJob.create({
      engagementId: engagement._id,
      toolId: "container_security_scan",
      targetUrl: engagement.targetUrl,
      status: jobStatus,
      startedAt: new Date(startedAt),
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      output: {
        findings: normalizedFindings,
        source: "container_security",
        attemptedFiles: result.attemptedFiles || [],
        filesFound: result.filesFound || [],
        checksRan: result.checksRan || [],
        status: result.status || "SUCCESS",
        skipped: Boolean(result.skipped),
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
        endpoint: "/api/container/scan/:engagementId",
        attemptedFiles: result.attemptedFiles || [],
        filesFound: result.filesFound || [],
        checksRan: result.checksRan || []
      },
      job: job.toObject(),
      meta: {
        trigger: "route",
        scanner: "VENOM Container Scanner"
      }
    });

    return res.status(200).json({
      message: "Container security scan complete",
      executionJobId: String(job._id),
      testId: executionMeta.testId,
      count: normalizedFindings.length,
      summary: summarizeBySeverity(normalizedFindings),
      findings: normalizedFindings
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    logger.error(
      { error: error?.message || String(error), stack: error?.stack || "" },
      "Container security scan route failed"
    );
    return next(error);
  }
});

router.get("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find({
      engagementId: req.params.engagementId,
      toolId: "container_security_scan"
    })
      .sort({ createdAt: -1 })
      .lean();

    const findings = jobs.flatMap((job) => {
      if (Array.isArray(job.findings) && job.findings.length > 0) {
        return job.findings;
      }
      return Array.isArray(job.output?.findings) ? job.output.findings : [];
    });

    const filtered = filterContainerFindings(findings);
    const summary = summarizeBySeverity(filtered);
    return res.status(200).json({
      count: filtered.length,
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      findings: filtered
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    return next(error);
  }
});

module.exports = router;
