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
const reportGeneratorService = require("./reportGeneratorService");
const executionLoggerService = require("./executionLoggerService");
const { logger } = require("../config/logger");

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
  } catch {
    // no-op for orchestrator control flow
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
    metadata: finding.metadata || {}
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
  if (id.includes("supply")) {
    return "Supply Chain";
  }
  if (id.includes("cloud")) {
    return "Cloud Configuration";
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
  findingDefaults = {},
  executionMeta = null
}) {
  return ExecutionJob.create({
    engagementId: engagement._id,
    toolId,
    targetUrl: engagement.targetUrl,
    status: failed ? "failed" : "success",
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 0,
    output: {
      findings,
      ...output
    },
    findings: findings.map((finding, index) => {
      const normalized = toExecutionFinding(finding, index, findingDefaults);
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

async function runPostExecutionScans(engagement, userId) {
  const engagementId = String(engagement._id);
  const summaries = [];

  try {
    const testId = buildExecutionTestId("secrets_scan", "post");
    const testName = toExecutionTestName("secrets_scan");
    const secretsResult = await secretsDetectionService.scanEngagement(engagementId);
    const secretsFindings = asArray(secretsResult.findings);
    const secretsJob = await persistScanJob({
      engagement,
      toolId: "secrets_scan",
      findings: secretsFindings,
      output: {
        source: "secrets_detection",
        error: secretsResult.error || null
      },
      createdBy: userId,
      failed: Boolean(secretsResult.error) && secretsFindings.length === 0,
      failureMessage: secretsResult.error || "",
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
      findings: secretsFindings.length,
      error: secretsResult.error || null
    });
  } catch (error) {
    logger.warn(
      { engagementId, error: error?.message || String(error) },
      "Secrets scan post-step failed"
    );
  }

  try {
    const testId = buildExecutionTestId("supply_chain_scan", "post");
    const testName = toExecutionTestName("supply_chain_scan");
    const supplyChainResult = await supplyChainService.scanEngagement(
      engagementId,
      engagement.targetUrl
    );
    const supplyFindings = asArray(supplyChainResult.findings);
    const supplyJob = await persistScanJob({
      engagement,
      toolId: "supply_chain_scan",
      findings: supplyFindings,
      output: {
        source: "supply_chain",
        vulnerabilities: supplyChainResult.vulnerabilities || [],
        error: supplyChainResult.error || null
      },
      createdBy: userId,
      failed: Boolean(supplyChainResult.error) && supplyFindings.length === 0,
      failureMessage: supplyChainResult.error || "",
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
      findings: supplyFindings.length,
      error: supplyChainResult.error || null
    });
  } catch (error) {
    logger.warn(
      { engagementId, error: error?.message || String(error) },
      "Supply-chain scan post-step failed"
    );
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

    await Engagement.updateOne(
      { _id: engagement._id },
      { $set: { status: "completed", completedAt: new Date() } }
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
      postScanResults
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
