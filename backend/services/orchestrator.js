const Engagement = require("../models/Engagement");
const Plan = require("../models/Plan");
const ExecutionJob = require("../models/ExecutionJob");
const { generatePlanForEngagement, PROMPT_VERSION } = require("./planner");
const { executeEngagementTool } = require("./executionService");
const { runLearningCycle } = require("./learner");
const { broadcastToRoom } = require("./realtimeServer");
const { assertExecutionAllowed } = require("./trustControl");
const { createSnapshot, detectChanges } = require("./changeDetector");
const secretsDetectionService = require("./secretsDetectionService");
const supplyChainService = require("./supplyChainService");
const cloudMisconfigService = require("./cloudMisconfigService");
const apiSecurityService = require("./apiSecurityService");
const containerSecurityService = require("./containerSecurityService");
const complianceMapperService = require("./complianceMapperService");
const reportGeneratorService = require("./reportGeneratorService");
const executionLoggerService = require("./executionLoggerService");
const aiAppScannerService = require("./aiAppScannerService");
const { logger } = require("../config/logger");
const {
  createStructuredError,
  logError,
  logWarn
} = require("../utils/scanErrors");

const DEFAULT_TOOL_SEQUENCE = {
  website: [
    "http_headers_probe",
    "dns_lookup_probe",
    "tls_metadata_probe",
    "nmap_tcp_scan",
    "nuclei_scan"
  ],
  api: [
    "http_headers_probe",
    "dns_lookup_probe",
    "tls_metadata_probe",
    "nuclei_scan",
    "sqlmap_detect"
  ],
  network: ["nmap_tcp_scan", "dns_lookup_probe", "tls_metadata_probe", "nuclei_scan"]
};

const activeOrchestrations = new Map();

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMaxConcurrent() {
  return Math.max(1, toInteger(process.env.MAX_CONCURRENT_TARGETS, 3));
}

function normalizeToolId(toolId) {
  return String(toolId || "").trim();
}

function deriveToolSequenceFromPlan(plan, targetType) {
  if (!plan || !Array.isArray(plan.phases)) {
    return [...(DEFAULT_TOOL_SEQUENCE[targetType] || DEFAULT_TOOL_SEQUENCE.website)];
  }

  const sequence = [];
  const learnedRecommendations = Array.isArray(plan.learnedRecommendations)
    ? plan.learnedRecommendations
    : [];
  const learnedTools = learnedRecommendations
    .map((item) => normalizeToolId(item?.tool))
    .filter(Boolean);
  const phaseText = plan.phases
    .map((phase) => `${phase.name || ""} ${phase.goal || ""} ${(phase.checks || []).join(" ")}`)
    .join(" ")
    .toLowerCase();

  // Always start with low-risk baseline probes.
  sequence.push("http_headers_probe", "dns_lookup_probe", "tls_metadata_probe");
  if (learnedTools.length > 0) {
    sequence.push(...learnedTools);
  }

  if (/network|port|service|exposed/.test(phaseText)) {
    sequence.push("nmap_tcp_scan");
  }
  if (/template|cve|vulnerab|misconfig|risk/.test(phaseText)) {
    sequence.push("nuclei_scan");
  }
  if (/server|config|header|hardening/.test(phaseText)) {
    sequence.push("nikto_scan");
  }
  if (/api|parameter|input|injection|sql/.test(phaseText)) {
    sequence.push("sqlmap_detect");
  }

  if (sequence.length <= 3) {
    sequence.push(...(DEFAULT_TOOL_SEQUENCE[targetType] || DEFAULT_TOOL_SEQUENCE.website));
  }

  const deduped = [];
  const seen = new Set();
  for (const item of sequence.map(normalizeToolId)) {
    if (!item || seen.has(item)) {
      continue;
    }
    deduped.push(item);
    seen.add(item);
  }
  return deduped;
}

function serializeActiveOrchestration(entry) {
  return {
    engagementId: entry.engagementId,
    targetUrl: entry.targetUrl,
    startedAt: entry.startedAt,
    startedBy: entry.startedBy,
    state: entry.state,
    step: entry.step,
    totalSteps: entry.totalSteps,
    lastUpdateAt: entry.lastUpdateAt
  };
}

function broadcastOrchestrationEvent(engagementId, event, payload) {
  try {
    broadcastToRoom(engagementId, event, payload);
  } catch (error) {
    logWarn(logger, { engagementId, event }, "Realtime orchestration broadcast failed", error);
  }
}

function getOrchestratorStatus() {
  const active = {};
  for (const [engagementId, entry] of activeOrchestrations.entries()) {
    active[engagementId] = serializeActiveOrchestration(entry);
  }

  return {
    activeCount: activeOrchestrations.size,
    maxConcurrent: getMaxConcurrent(),
    active
  };
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.httpStatus = statusCode;
  return error;
}

function toExecutionFinding(finding = {}, index = 0, defaults = {}) {
  const evidenceValue =
    finding.evidence && typeof finding.evidence === "object"
      ? finding.evidence
      : String(finding.evidence || "").trim()
        ? finding.evidence
        : {
            status: "failed",
            reason:
              "Evidence capture failed — scanner did not persist request/response evidence for this finding."
          };
  const discoveryVector =
    String(finding.discoveryVector || finding.metadata?.discoveryVector || "").trim() ||
    "Evidence capture failed — discovery vector was not provided by scanner output.";
  const reproductionSteps = Array.isArray(finding.reproductionSteps)
    ? finding.reproductionSteps.filter((step) => String(step || "").trim().length > 0)
    : Array.isArray(finding.metadata?.reproductionSteps)
      ? finding.metadata.reproductionSteps.filter(
          (step) => String(step || "").trim().length > 0
        )
      : [];
  return {
    id: finding.id || `${defaults.idPrefix || "scan"}-${index + 1}`,
    severity: finding.severity || defaults.severity || "low",
    category: finding.category || defaults.category || "Security",
    title: finding.title || defaults.title || "Scanner finding",
    description: finding.description || defaults.description || "Scanner finding recorded.",
    recommendation:
      finding.recommendation ||
      finding.remediation ||
      defaults.recommendation ||
      "Review and remediate this finding according to security best practices.",
    source: finding.source || defaults.source || "post_scan",
    cve: finding.cve || null,
    cvssScore: Number.isFinite(Number(finding.cvssScore))
      ? Number(finding.cvssScore)
      : null,
    tags: Array.isArray(finding.tags) ? finding.tags : asArray(defaults.tags),
    evidence: evidenceValue,
    discoveryVector,
    reproductionSteps:
      reproductionSteps.length > 0
        ? reproductionSteps
        : [
            `curl -i -X GET '${defaults.targetUrl || "https://target.example"}'`,
            "Evidence capture failed — scanner did not provide reproducible request steps."
          ],
    metadata: {
      ...(finding.metadata || {}),
      evidence: evidenceValue,
      discoveryVector,
      reproductionSteps:
        reproductionSteps.length > 0
          ? reproductionSteps
          : [
              `curl -i -X GET '${defaults.targetUrl || "https://target.example"}'`,
              "Evidence capture failed — scanner did not provide reproducible request steps."
            ]
    }
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function flattenJobFindings(jobs = []) {
  return jobs.flatMap((job) => {
    const topLevel = asArray(job?.findings);
    if (topLevel.length > 0) {
      return topLevel;
    }
    return asArray(job?.output?.findings);
  });
}

function buildExecutionTestId(toolId, phase = "scan") {
  return `test-${phase}-${String(toolId || "unknown")}-${Date.now()}-${Math.floor(
    Math.random() * 1000
  )}`;
}

function toExecutionCategory(toolId) {
  const id = String(toolId || "").toLowerCase();
  if (id.includes("secret")) {
    return "Secrets";
  }
  if (id.includes("ai")) {
    return "AI & LLM Security";
  }
  if (id.includes("supply")) {
    return "Supply Chain";
  }
  if (id.includes("cloud")) {
    return "Cloud Configuration";
  }
  if (id.includes("api_security")) {
    return "API Security";
  }
  if (id.includes("container_security")) {
    return "Container Security";
  }
  if (id.includes("header") || id.includes("tls") || id.includes("dns")) {
    return "Security Headers";
  }
  if (id.includes("sql") || id.includes("nuclei") || id.includes("nikto")) {
    return "Injection and Vulnerability";
  }
  if (id.includes("nmap")) {
    return "Network Exposure";
  }
  if (id.includes("report")) {
    return "Reporting";
  }
  return "General";
}

function toExecutionTestName(toolId) {
  const map = {
    http_headers_probe: "HTTP Security Headers Check",
    dns_lookup_probe: "DNS Configuration Probe",
    tls_metadata_probe: "TLS Metadata Validation",
    nmap_tcp_scan: "Network Port Exposure Scan",
    nuclei_scan: "Nuclei Vulnerability Scan",
    nikto_scan: "Nikto Web Misconfiguration Scan",
    sqlmap_detect: "SQL Injection Probe",
    secrets_scan: "Secrets Detection Scan",
    supply_chain_scan: "Supply Chain Dependency Scan",
    cloud_misconfig_scan: "Cloud Misconfiguration Scan",
    api_security_scan: "API Security Scan",
    container_security_scan: "Container Security Scan",
    ai_app_scan: "AI-App Security Scan",
    hardened_report_generation: "Hardened Report Generation"
  };
  return map[String(toolId || "")] || `Execution of ${toolId}`;
}

async function persistScanJob({
  engagement,
  toolId,
  findings = [],
  output = {},
  createdBy = "unknown",
  failed = false,
  failureMessage = "",
  status = "",
  durationMs = 0,
  findingDefaults = {},
  executionMeta = null
}) {
  return ExecutionJob.create({
    engagementId: engagement._id,
    toolId,
    targetUrl: engagement.targetUrl,
    status: status || (failed ? "failed" : "success"),
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs,
    output: {
      findings,
      ...output
    },
    findings: findings.map((finding, index) => {
      const normalized = toExecutionFinding(finding, index, {
        ...(findingDefaults || {}),
        targetUrl: engagement.targetUrl
      });
      if (!executionMeta) {
        return normalized;
      }
      return {
        ...normalized,
        metadata: {
          ...(normalized.metadata || {}),
          executionTestId: executionMeta.testId,
          testId: executionMeta.testId,
          executionTestName: executionMeta.testName,
          targetUrl: engagement.targetUrl
        }
      };
    }),
    errorMessage: failed ? failureMessage : "",
    createdBy
  });
}

function getPostScanJobStatus(result = {}, findings = []) {
  const status = String(result.status || "").toUpperCase();
  if (status === "NOT_APPLICABLE") {
    return "not_applicable";
  }
  if (status === "TOOL_NOT_INSTALLED") {
    return "tool_not_installed";
  }
  if (status === "ERROR") {
    return "failed";
  }
  if (result.error && findings.length === 0) {
    return "failed";
  }
  return "success";
}

function getPostScanFailureMessage(result = {}) {
  return (
    result.failureReason ||
    result.error ||
    result.message ||
    result.reason ||
    ""
  );
}

async function persistFailedPostScan({
  engagement,
  userId,
  toolId,
  error,
  testId,
  testName
}) {
  const structuredError = createStructuredError(error);
  const failedJob = await persistScanJob({
    engagement,
    toolId,
    findings: [],
    output: {
      source: toolId,
      ...structuredError
    },
    createdBy: userId,
    failed: true,
    failureMessage: structuredError.failureReason,
    status: "failed",
    executionMeta: { testId, testName }
  });
  await executionLoggerService.logExecutionJob({
    engagementId: String(engagement._id),
    testId,
    testName,
    tool: toolId,
    category: toExecutionCategory(toolId),
    target: engagement.targetUrl,
    parameters: {
      mode: "post-orchestration",
      source: toolId
    },
    job: failedJob.toObject(),
    meta: {
      scanner: toolId,
      errorCode: structuredError.errorCode
    }
  });
  return structuredError;
}

async function runPostExecutionScans(engagement, userId) {
  const engagementId = String(engagement._id);
  const summaries = [];

  try {
    const testId = buildExecutionTestId("secrets_scan", "post");
    const testName = toExecutionTestName("secrets_scan");
    const secretsResult = await secretsDetectionService.scanEngagement(engagementId);
    const secretsFindings = asArray(secretsResult.findings);
    const secretsStatus = getPostScanJobStatus(secretsResult, secretsFindings);
    const secretsJob = await persistScanJob({
      engagement,
      toolId: "secrets_scan",
      findings: secretsFindings,
      output: {
        source: "secrets_detection",
        status: secretsResult.status || "SUCCESS",
        reason: secretsResult.reason || "",
        failureReason: secretsResult.failureReason || "",
        errorCode: secretsResult.errorCode || "",
        attemptedFiles: secretsResult.attemptedFiles || [],
        filesFound: secretsResult.filesFound || [],
        error: secretsResult.error || null
      },
      createdBy: userId,
      failed: secretsStatus === "failed",
      failureMessage: getPostScanFailureMessage(secretsResult),
      status: secretsStatus,
      durationMs: secretsResult.durationMs || 0,
      findingDefaults: {
        idPrefix: "secret",
        severity: "critical",
        category: "Secrets Exposure",
        source: "secrets_detection",
        tags: ["secrets"]
      },
      executionMeta: {
        testId,
        testName
      }
    });
    await executionLoggerService.logExecutionJob({
      engagementId: String(engagement._id),
      testId,
      testName,
      tool: "secrets_scan",
      category: toExecutionCategory("secrets_scan"),
      target: engagement.targetUrl,
      parameters: {
        mode: "post-orchestration",
        source: "secrets_detection"
      },
      job: secretsJob.toObject()
    });
    summaries.push({
      toolId: "secrets_scan",
      status: secretsStatus,
      findings: secretsFindings.length,
      error: secretsResult.error || null,
      reason: getPostScanFailureMessage(secretsResult)
    });
  } catch (error) {
    logError(logger, { engagementId, toolId: "secrets_scan" }, "Secrets scan post-step failed", error);
    await persistFailedPostScan({
      engagement,
      userId,
      toolId: "secrets_scan",
      error,
      testId: buildExecutionTestId("secrets_scan", "post-error"),
      testName: toExecutionTestName("secrets_scan")
    });
  }

  try {
    const testId = buildExecutionTestId("supply_chain_scan", "post");
    const testName = toExecutionTestName("supply_chain_scan");
    const supplyChainResult = await supplyChainService.scanEngagement(
      engagementId,
      engagement.targetUrl
    );
    const supplyFindings = asArray(supplyChainResult.findings);
    const supplyStatus = getPostScanJobStatus(supplyChainResult, supplyFindings);
    const supplyJob = await persistScanJob({
      engagement,
      toolId: "supply_chain_scan",
      findings: supplyFindings,
      output: {
        source: "supply_chain",
        status: supplyChainResult.status || "SUCCESS",
        vulnerabilities: supplyChainResult.vulnerabilities || [],
        attemptedFiles: supplyChainResult.attemptedFiles || [],
        filesFound: supplyChainResult.filesFound || [],
        reason: supplyChainResult.reason || "",
        failureReason: supplyChainResult.failureReason || "",
        errorCode: supplyChainResult.errorCode || "",
        error: supplyChainResult.error || null
      },
      createdBy: userId,
      failed: supplyStatus === "failed",
      failureMessage: getPostScanFailureMessage(supplyChainResult),
      status: supplyStatus,
      durationMs: supplyChainResult.durationMs || 0,
      findingDefaults: {
        idPrefix: "supply",
        severity: "medium",
        category: "Supply Chain",
        source: "supply_chain",
        tags: ["supply-chain"]
      },
      executionMeta: {
        testId,
        testName
      }
    });
    await executionLoggerService.logExecutionJob({
      engagementId: String(engagement._id),
      testId,
      testName,
      tool: "supply_chain_scan",
      category: toExecutionCategory("supply_chain_scan"),
      target: engagement.targetUrl,
      parameters: {
        mode: "post-orchestration",
        source: "supply_chain",
        dependencySource: "package_manifest"
      },
      job: supplyJob.toObject()
    });
    summaries.push({
      toolId: "supply_chain_scan",
      status: supplyStatus,
      findings: supplyFindings.length,
      error: supplyChainResult.error || null,
      reason: getPostScanFailureMessage(supplyChainResult)
    });
  } catch (error) {
    logError(logger, { engagementId, toolId: "supply_chain_scan" }, "Supply-chain scan post-step failed", error);
    await persistFailedPostScan({
      engagement,
      userId,
      toolId: "supply_chain_scan",
      error,
      testId: buildExecutionTestId("supply_chain_scan", "post-error"),
      testName: toExecutionTestName("supply_chain_scan")
    });
  }

  const hasAwsCredentials = Boolean(
    String(process.env.AWS_ACCESS_KEY_ID || "").trim() &&
      String(process.env.AWS_SECRET_ACCESS_KEY || "").trim()
  );
  if (hasAwsCredentials) {
    try {
      const testId = buildExecutionTestId("cloud_misconfig_scan", "post");
      const testName = toExecutionTestName("cloud_misconfig_scan");
      const cloudFindings = await cloudMisconfigService.scanAWSAccount({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN || "",
        region: process.env.AWS_REGION || "us-east-1"
      });
      const cloudJob = await persistScanJob({
        engagement,
        toolId: "cloud_misconfig_scan",
        findings: asArray(cloudFindings),
        output: {
          source: "cloud_misconfiguration",
          scannedRegion: process.env.AWS_REGION || "us-east-1"
        },
        createdBy: userId,
        findingDefaults: {
          idPrefix: "cloud",
          severity: "high",
          category: "Cloud Configuration",
          source: "cloud_misconfiguration",
          tags: ["cloud", "aws"]
        },
        executionMeta: {
          testId,
          testName
        }
      });
      await executionLoggerService.logExecutionJob({
        engagementId: String(engagement._id),
        testId,
        testName,
        tool: "cloud_misconfig_scan",
        category: toExecutionCategory("cloud_misconfig_scan"),
        target: engagement.targetUrl,
        parameters: {
          mode: "post-orchestration",
          region: process.env.AWS_REGION || "us-east-1"
        },
        job: cloudJob.toObject()
      });
      summaries.push({
        toolId: "cloud_misconfig_scan",
        findings: asArray(cloudFindings).length,
        error: null
      });
    } catch (error) {
      logger.warn(
        { engagementId, error: error?.message || String(error) },
        "Cloud misconfiguration post-step failed"
      );
    }
  } else {
    summaries.push({
      toolId: "cloud_misconfig_scan",
      findings: 0,
      skipped: true,
      reason: "AWS credentials not configured"
    });
  }

  try {
    const testId = buildExecutionTestId("api_security_scan", "post");
    const testName = toExecutionTestName("api_security_scan");
    const apiResult = await apiSecurityService.scanEngagement(
      engagementId,
      engagement.targetUrl
    );
    const apiFindings = asArray(apiResult.findings);
    const apiStatus = getPostScanJobStatus(apiResult, apiFindings);
    const apiJob = await persistScanJob({
      engagement,
      toolId: "api_security_scan",
      findings: apiFindings,
      output: {
        source: "api_security",
        status: apiResult.status || "SUCCESS",
        scannedEndpoints: apiResult.scannedEndpoints || [],
        endpointCount: apiResult.endpointCount || 0,
        probedUrlCount: apiResult.probedUrlCount || apiResult.endpointCount || 0,
        scanLimitations: apiResult.scanLimitations || [],
        discoveryAudit: apiResult.discoveryAudit || [],
        defenseSignals: apiResult.defenseSignals || [],
        reason: apiResult.reason || "",
        failureReason: apiResult.failureReason || "",
        errorCode: apiResult.errorCode || "",
        error: apiResult.error || null
      },
      createdBy: userId,
      failed: apiStatus === "failed",
      failureMessage: getPostScanFailureMessage(apiResult),
      status: apiStatus,
      durationMs: apiResult.durationMs || 0,
      findingDefaults: {
        idPrefix: "api",
        severity: "medium",
        category: "API Security",
        source: "api_security",
        tags: ["api-security"]
      },
      executionMeta: {
        testId,
        testName
      }
    });
    await executionLoggerService.logExecutionJob({
      engagementId: String(engagement._id),
      testId,
      testName,
      tool: "api_security_scan",
      category: toExecutionCategory("api_security_scan"),
      target: engagement.targetUrl,
      parameters: {
        mode: "post-orchestration",
        source: "api_security",
        endpointCount: apiResult.endpointCount || 0
      },
      job: apiJob.toObject(),
      meta: {
        scanner: "VENOM API Scanner"
      }
    });
    summaries.push({
      toolId: "api_security_scan",
      status: apiStatus,
      findings: apiFindings.length,
      error: apiResult.error || null,
      reason: getPostScanFailureMessage(apiResult)
    });
  } catch (error) {
    logError(logger, { engagementId, toolId: "api_security_scan" }, "API security post-step failed", error);
    await persistFailedPostScan({
      engagement,
      userId,
      toolId: "api_security_scan",
      error,
      testId: buildExecutionTestId("api_security_scan", "post-error"),
      testName: toExecutionTestName("api_security_scan")
    });
  }

  try {
    const testId = buildExecutionTestId("container_security_scan", "post");
    const testName = toExecutionTestName("container_security_scan");
    const containerResult = await containerSecurityService.scanEngagement(
      engagementId,
      engagement.targetUrl
    );
    const containerFindings = asArray(containerResult.findings);
    const containerStatus = getPostScanJobStatus(containerResult, containerFindings);
    const containerJob = await persistScanJob({
      engagement,
      toolId: "container_security_scan",
      findings: containerFindings,
      output: {
        source: "container_security",
        status: containerResult.status || "SUCCESS",
        attemptedFiles: containerResult.attemptedFiles || [],
        filesFound: containerResult.filesFound || [],
        checksRan: containerResult.checksRan || [],
        skipped: Boolean(containerResult.skipped),
        reason: containerResult.reason || "",
        failureReason: containerResult.failureReason || "",
        errorCode: containerResult.errorCode || "",
        error: containerResult.error || null
      },
      createdBy: userId,
      failed: containerStatus === "failed",
      failureMessage: getPostScanFailureMessage(containerResult),
      status: containerStatus,
      durationMs: containerResult.durationMs || 0,
      findingDefaults: {
        idPrefix: "container",
        severity: "medium",
        category: "Container Security",
        source: "container_security",
        tags: ["container-security"]
      },
      executionMeta: {
        testId,
        testName
      }
    });
    await executionLoggerService.logExecutionJob({
      engagementId: String(engagement._id),
      testId,
      testName,
      tool: "container_security_scan",
      category: toExecutionCategory("container_security_scan"),
      target: engagement.targetUrl,
      parameters: {
        mode: "post-orchestration",
        source: "container_security",
        attemptedFiles: containerResult.attemptedFiles || [],
        filesFound: containerResult.filesFound || [],
        checksRan: containerResult.checksRan || []
      },
      job: containerJob.toObject(),
      meta: {
        scanner: "VENOM Container Scanner"
      }
    });
    summaries.push({
      toolId: "container_security_scan",
      status: containerStatus,
      findings: containerFindings.length,
      error: containerResult.error || null,
      reason: getPostScanFailureMessage(containerResult)
    });
  } catch (error) {
    logError(logger, { engagementId, toolId: "container_security_scan" }, "Container security post-step failed", error);
    await persistFailedPostScan({
      engagement,
      userId,
      toolId: "container_security_scan",
      error,
      testId: buildExecutionTestId("container_security_scan", "post-error"),
      testName: toExecutionTestName("container_security_scan")
    });
  }

  try {
    const testId = buildExecutionTestId("ai_app_scan", "post");
    const testName = toExecutionTestName("ai_app_scan");
    const aiResult = await aiAppScannerService.scanEngagement(engagementId);
    const aiFindings = asArray(aiResult.findings);
    const aiJob = await persistScanJob({
      engagement,
      toolId: "ai_app_scan",
      findings: aiFindings,
      output: {
        source: "ai_app_scanner",
        error: aiResult.error || null
      },
      createdBy: userId,
      failed: Boolean(aiResult.error) && aiFindings.length === 0,
      failureMessage: aiResult.error || "",
      findingDefaults: {
        idPrefix: "ai",
        severity: "medium",
        category: "AI & LLM Security",
        source: "ai_scanner",
        tags: ["ai"]
      },
      executionMeta: {
        testId,
        testName
      }
    });
    await executionLoggerService.logExecutionJob({
      engagementId: String(engagement._id),
      testId,
      testName,
      tool: "ai_app_scan",
      category: toExecutionCategory("ai_app_scan"),
      target: engagement.targetUrl,
      parameters: {
        mode: "post-orchestration",
        source: "ai_app_scanner"
      },
      job: aiJob.toObject()
    });
    summaries.push({
      toolId: "ai_app_scan",
      findings: aiFindings.length,
      error: aiResult.error || null
    });
  } catch (error) {
    logger.warn(
      { engagementId, error: error?.message || String(error) },
      "AI-App security post-step failed"
    );
  }

  try {
    const testId = buildExecutionTestId("hardened_report_generation", "post");
    const testName = toExecutionTestName("hardened_report_generation");
    const hardenedReport = await reportGeneratorService.generateReport(engagementId);
    const reportJob = await persistScanJob({
      engagement,
      toolId: "hardened_report_generation",
      findings: [],
      output: {
        source: "hardened_report",
        report: hardenedReport
      },
      createdBy: userId,
      executionMeta: {
        testId,
        testName
      }
    });
    await executionLoggerService.logExecutionJob({
      engagementId: String(engagement._id),
      testId,
      testName,
      tool: "hardened_report_generation",
      category: toExecutionCategory("hardened_report_generation"),
      target: engagement.targetUrl,
      parameters: {
        mode: "post-orchestration",
        reportType: "hardened"
      },
      job: reportJob.toObject(),
      meta: {
        reportVersion: hardenedReport.structureVersion || "phase1.v1"
      }
    });
    summaries.push({
      toolId: "hardened_report_generation",
      findings: asArray(hardenedReport.findings).length
    });
  } catch (error) {
    logger.warn(
      { engagementId, error: error?.message || String(error) },
      "Hardened report generation post-step failed"
    );
  }

  return summaries;
}

async function persistGeneratedPlan(engagement, planningResult, createdBy) {
  return Plan.create({
    engagementId: engagement._id,
    promptVersion: planningResult.promptVersion || PROMPT_VERSION,
    plannerSource: planningResult.source || "template",
    model: planningResult.model || "template-planner-v1",
    rationale: planningResult.rationale || "",
    confidence:
      Number.isFinite(Number(planningResult.confidence))
        ? Number(planningResult.confidence)
        : 0.5,
    learnedPatterns: Array.isArray(planningResult.learnedPatterns)
      ? planningResult.learnedPatterns
      : [],
    learnedRecommendations: Array.isArray(planningResult.learnedRecommendations)
      ? planningResult.learnedRecommendations
      : [],
    summary: planningResult.plan?.summary || "",
    phases: planningResult.plan?.phases || [],
    riskNotes: planningResult.plan?.riskNotes || [],
    disclaimers: planningResult.plan?.disclaimers || [],
    inputSnapshot: {
      targetUrl: engagement.targetUrl,
      targetType: engagement.targetType,
      scope: engagement.scope,
      constraints: engagement.constraints,
      authorization: engagement.authorization
    },
    rawModelOutput: planningResult.rawModelOutput || "",
    createdBy
  });
}

async function buildComplianceReportForEngagement(engagementId) {
  const jobs = await ExecutionJob.find({ engagementId }).sort({ createdAt: -1 }).lean();
  const findings = flattenJobFindings(jobs);
  return complianceMapperService.generateComplianceReport(findings);
}

async function orchestrateSingle(engagementId, userId = "unknown") {
  if (activeOrchestrations.has(engagementId)) {
    throw createHttpError(409, "Engagement is already being orchestrated");
  }

  const engagement = await Engagement.findById(engagementId).lean();
  if (!engagement) {
    throw createHttpError(404, "Engagement not found");
  }

  await assertExecutionAllowed(String(engagement._id));

  if (
    engagement.authorization?.validUntil &&
    new Date(engagement.authorization.validUntil) < new Date()
  ) {
    throw createHttpError(403, "Cannot orchestrate expired authorization");
  }

  activeOrchestrations.set(engagementId, {
    engagementId,
    targetUrl: engagement.targetUrl,
    startedAt: new Date().toISOString(),
    startedBy: userId,
    state: "planning",
    step: 0,
    totalSteps: 0,
    lastUpdateAt: new Date().toISOString()
  });

  const entry = activeOrchestrations.get(engagementId);
  try {
    logger.info(
      { engagementId, targetUrl: engagement.targetUrl, userId },
      "Starting auto-orchestration"
    );
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "planning",
      engagementId
    });

    await Engagement.updateOne(
      { _id: engagement._id },
      { $set: { status: "running" } }
    );

    const planningResult = await generatePlanForEngagement(engagement);
    const savedPlan = await persistGeneratedPlan(engagement, planningResult, userId);
    const toolSequence = deriveToolSequenceFromPlan(
      {
        ...(planningResult.plan || {}),
        learnedRecommendations: planningResult.learnedRecommendations || []
      },
      engagement.targetType
    );
    logger.info(
      {
        engagementId,
        plannerSource: savedPlan.plannerSource,
        promptVersion: savedPlan.promptVersion,
        toolsPlanned: toolSequence.length
      },
      "Executing reconnaissance tools"
    );

    entry.state = "executing";
    entry.totalSteps = toolSequence.length;
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "executing",
      engagementId,
      totalSteps: entry.totalSteps
    });

    const executionResults = [];
    for (let index = 0; index < toolSequence.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await assertExecutionAllowed(String(engagement._id));

      const toolId = toolSequence[index];
      entry.step = index + 1;
      entry.lastUpdateAt = new Date().toISOString();
      broadcastOrchestrationEvent(engagementId, "orchestration_step", {
        engagementId,
        step: entry.step,
        totalSteps: entry.totalSteps,
        toolId
      });
      logger.info(
        {
          engagementId,
          toolId,
          step: entry.step,
          totalSteps: entry.totalSteps
        },
        "Executing engagement tool"
      );

      // eslint-disable-next-line no-await-in-loop
      const execution = await executeEngagementTool({
        engagementId: String(engagement._id),
        toolId,
        requestedTargetUrl: engagement.targetUrl,
        userId
      });
      const executionTestId = buildExecutionTestId(toolId, "tool");
      const executionTestName = toExecutionTestName(toolId);
      const traceEntry = await executionLoggerService.logExecutionJob({
        engagementId: String(engagement._id),
        testId: executionTestId,
        testName: executionTestName,
        tool: toolId,
        category: toExecutionCategory(toolId),
        target: engagement.targetUrl,
        parameters: {
          step: entry.step,
          totalSteps: entry.totalSteps,
          toolId,
          targetUrl: engagement.targetUrl
        },
        job: execution.job,
        meta: {
          orchestrationState: "executing"
        }
      });
      if (traceEntry?.testId && Array.isArray(execution.job.findings)) {
        const enrichedFindings = execution.job.findings.map((finding) => ({
          ...finding,
          metadata: {
            ...(finding?.metadata || {}),
            executionTestId: traceEntry.testId,
            testId: traceEntry.testId,
            executionTestName: executionTestName,
            targetUrl: engagement.targetUrl
          }
        }));
        execution.job.findings = enrichedFindings;
        await ExecutionJob.updateOne(
          { _id: execution.job._id },
          {
            $set: {
              findings: enrichedFindings
            }
          }
        ).catch(() => {});
      }

      executionResults.push({
        toolId,
        status: execution.job.status,
        findings: Array.isArray(execution.job.findings) ? execution.job.findings.length : 0,
        durationMs: execution.job.durationMs || 0,
        jobId: execution.job._id
      });
      logger.info(
        {
          engagementId,
          toolId,
          status: execution.job.status,
          findingsCount: Array.isArray(execution.job.findings)
            ? execution.job.findings.length
            : 0,
          durationMs: execution.job.durationMs || 0
        },
        "Tool execution complete"
      );
    }

    entry.state = "learning";
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "learning",
      engagementId
    });
    logger.info({ engagementId }, "Recording learned patterns");
    const learningResult = await runLearningCycle(String(engagement._id));

    entry.state = "post_scan";
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "post_scan",
      engagementId
    });
    const postScanResults = await runPostExecutionScans(engagement, userId);
    let complianceReport = null;
    try {
      complianceReport = await buildComplianceReportForEngagement(String(engagement._id));
    } catch (error) {
      logger.warn(
        { engagementId, error: error?.message || String(error) },
        "Compliance report generation failed"
      );
    }

    await Engagement.updateOne(
      { _id: engagement._id },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          complianceReport
        }
      }
    );

    await createSnapshot(
      String(engagement._id),
      "post-engagement",
      userId
    ).catch(() => null);
    await detectChanges(String(engagement._id)).catch(() => null);

    entry.state = "completed";
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "completed",
      engagementId
    });
    logger.info(
      {
        engagementId,
        processedJobs: learningResult?.processedJobs || 0
      },
      "Auto-orchestration complete"
    );
    return {
      engagementId: String(engagement._id),
      targetUrl: engagement.targetUrl,
      status: "completed",
      promptVersion: savedPlan.promptVersion,
      plannerSource: savedPlan.plannerSource,
      toolSequence,
      executionResults,
      learningResult,
      postScanResults,
      complianceReport
    };
  } catch (error) {
    await Engagement.updateOne(
      { _id: engagement._id },
      { $set: { status: "failed" } }
    ).catch(() => {});
    entry.state = "failed";
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "failed",
      engagementId,
      error: error?.message || "orchestration failed"
    });
    logger.error(
      {
        engagementId,
        error: error?.message || "unknown error"
      },
      "Auto-orchestration failed"
    );
    throw error;
  } finally {
    setTimeout(() => {
      activeOrchestrations.delete(engagementId);
    }, 1500);
  }
}

async function orchestrateMultiple(engagementIds, userId = "unknown") {
  const uniqueIds = [...new Set((engagementIds || []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw createHttpError(400, "engagementIds must contain at least one id");
  }

  const maxConcurrent = getMaxConcurrent();
  const currentlyActive = activeOrchestrations.size;
  const availableSlots = Math.max(0, maxConcurrent - currentlyActive);
  if (availableSlots <= 0) {
    throw createHttpError(
      429,
      `Concurrency limit reached. Max ${maxConcurrent} active orchestrations.`
    );
  }

  const pending = uniqueIds.filter((id) => !activeOrchestrations.has(id));
  const scheduled = pending.slice(0, availableSlots);
  const skipped = uniqueIds
    .filter((id) => !scheduled.includes(id))
    .map((engagementId) => ({
      engagementId,
      reason: activeOrchestrations.has(engagementId)
        ? "already_active"
        : "max_concurrency_reached"
    }));

  const settled = await Promise.allSettled(
    scheduled.map((engagementId) => orchestrateSingle(engagementId, userId))
  );

  const results = settled.map((item, index) => ({
    engagementId: scheduled[index],
    status: item.status === "fulfilled" ? "fulfilled" : "rejected",
    result: item.status === "fulfilled" ? item.value : item.reason?.message || "unknown"
  }));

  return {
    requested: uniqueIds.length,
    scheduled: scheduled.length,
    skipped,
    maxConcurrent,
    currentlyActive,
    results
  };
}

module.exports = {
  orchestrateSingle,
  orchestrateMultiple,
  getOrchestratorStatus,
  __internal: {
    deriveToolSequenceFromPlan
  }
};
