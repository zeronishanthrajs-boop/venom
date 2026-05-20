const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const apiSecurityService = require("../services/apiSecurityService");
const executionLoggerService = require("../services/executionLoggerService");
const { logger } = require("../config/logger");

const router = express.Router();

function buildExecutionMeta() {
  return {
    testId: `test-api-security-scan-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    testName: "API Security Scan",
    category: "API Security",
    tool: "api_security_scan"
  };
}

function normalizeFindingType(finding = {}) {
  const metadataType = String(finding?.metadata?.findingType || "").trim();
  if (metadataType) {
    return metadataType;
  }
  const explicitType = String(finding?.type || "").trim();
  if (explicitType) {
    return explicitType;
  }
  const title = String(finding?.title || "").toUpperCase();
  if (title.includes("BOLA")) {
    return "API_BROKEN_OBJECT_LEVEL_AUTHORIZATION";
  }
  if (title.includes("UNAUTHENTICATED")) {
    return "API_MISSING_AUTHENTICATION";
  }
  if (title.includes("RATE LIMIT")) {
    return "API_MISSING_RATE_LIMIT";
  }
  if (title.includes("GRAPHQL")) {
    return "API_GRAPHQL_INTROSPECTION_ENABLED";
  }
  return "API_SECURITY_FINDING";
}

function toExecutionFinding(finding = {}, index = 0, executionMeta = null, targetUrl = "") {
  const findingType = normalizeFindingType(finding);
  return {
    id: finding.id || `api-${index + 1}`,
    severity: finding.severity || "medium",
    category: finding.category || "API Security",
    title: finding.title || "Potential API security issue detected",
    description: finding.description || "Potential API security issue detected during scan.",
    recommendation:
      finding.recommendation ||
      finding.remediation ||
      "Enforce strict API authentication, authorization, and validation controls.",
    source: finding.source || "api_security",
    tags: Array.isArray(finding.tags) ? finding.tags : ["api-security"],
    metadata: {
      ...(finding.metadata || {}),
      endpoint: finding.endpoint || finding.metadata?.endpoint || "",
      methodTested: finding.methodTested || finding.metadata?.methodTested || "GET",
      testPerformed: finding.testPerformed || finding.metadata?.testPerformed || "",
      responseObserved: finding.responseObserved || finding.metadata?.responseObserved || "",
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

function filterApiFindings(findings = []) {
  return findings.filter((finding) => {
    const findingType = normalizeFindingType(finding);
    return findingType.startsWith("API_");
  });
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
    const result = await apiSecurityService.scanEngagement(engagementId, engagement.targetUrl);
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const normalizedFindings = findings.map((finding, index) =>
      toExecutionFinding(finding, index, executionMeta, engagement.targetUrl)
    );
    const hasError = Boolean(result.error) && normalizedFindings.length === 0;

    const job = await ExecutionJob.create({
      engagementId: engagement._id,
      toolId: "api_security_scan",
      targetUrl: engagement.targetUrl,
      status: hasError ? "failed" : "success",
      startedAt: new Date(startedAt),
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      output: {
        findings: normalizedFindings,
        source: "api_security",
        scannedEndpoints: result.scannedEndpoints || [],
        endpointCount: result.endpointCount || 0,
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
        endpoint: "/api/apis/scan/:engagementId",
        endpointCount: result.endpointCount || 0
      },
      job: job.toObject(),
      meta: {
        trigger: "route",
        scanner: "VENOM API Scanner"
      }
    });

    return res.status(200).json({
      message: "API security scan complete",
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
      { error: error?.message || String(error) },
      "API security scan route failed"
    );
    return next(error);
  }
});

router.get("/:engagementId", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find({
      engagementId: req.params.engagementId,
      toolId: "api_security_scan"
    })
      .sort({ createdAt: -1 })
      .lean();

    const findings = jobs.flatMap((job) => {
      if (Array.isArray(job.findings) && job.findings.length > 0) {
        return job.findings;
      }
      return Array.isArray(job.output?.findings) ? job.output.findings : [];
    });

    const apiFindings = filterApiFindings(findings);
    const summary = summarizeBySeverity(apiFindings);
    return res.status(200).json({
      count: apiFindings.length,
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      findings: apiFindings
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid engagement id" });
    }
    return next(error);
  }
});

module.exports = router;
