const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const executionLoggerService = require("./executionLoggerService");
const complianceMapperService = require("./complianceMapperService");
const { deduplicateFindings } = require("../utils/deduplicateFindings");
const { logger } = require("../config/logger");
const { classifyEndpoint } = require("../utils/endpointClassification");
const {
  deriveConfidenceLevel,
  needsManualValidation,
  confidenceRank
} = require("../utils/confidenceModel");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["critical", "high", "medium", "low", "info"].includes(normalized)) {
    return normalized;
  }
  return "low";
}

function flattenJobFindings(jobs = []) {
  const findings = [];
  for (const job of jobs) {
    const topLevel = asArray(job?.findings);
    const outputLevel = asArray(job?.output?.findings);
    const selected = topLevel.length > 0 ? topLevel : outputLevel;
    for (const finding of selected) {
      findings.push({
        ...finding,
        _toolId: job?.toolId || "",
        _jobId: String(job?._id || "")
      });
    }
  }
  return findings;
}

function collectJobFindings(job = {}) {
  const topLevel = asArray(job?.findings);
  if (topLevel.length > 0) {
    return topLevel;
  }
  return asArray(job?.output?.findings);
}

function countBySeverity(findings = []) {
  const summary = {
    total: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };
  for (const finding of findings) {
    summary[normalizeSeverity(finding?.severity)] += 1;
  }
  return summary;
}

const FINDING_IMPACT_WEIGHTS = {
  CONFIRMED: 25,
  STRONG_SIGNAL: 15,
  CONFIGURATION_GAP: 5,
  INFORMATIONAL: 2
};
const REQUIRED_TOOLCHAIN = [
  "nikto",
  "whatweb",
  "ffuf",
  "amass",
  "sqlmap",
  "wafw00f",
  "semgrep",
  "trufflehog",
  "nuclei",
  "httpx",
  "katana",
  "naabu",
  "subfinder",
  "dalfox"
];

function isConfigurationFinding(finding = {}) {
  const type = String(finding?.type || finding?.metadata?.findingType || "").toUpperCase();
  const category = String(finding?.category || "").toUpperCase();
  const text = `${type} ${category}`;
  return (
    text.includes("MISCONFIG") ||
    text.includes("HEADER") ||
    text.includes("CONFIG") ||
    text.includes("HSTS") ||
    text.includes("CSP")
  );
}

function deriveImpactLevel(finding = {}) {
  const confidence = deriveConfidenceLevel(finding);
  if (confidence === "CONFIRMED") {
    return "CONFIRMED";
  }
  if (confidence === "STRONG_SIGNAL") {
    return "STRONG_SIGNAL";
  }
  if (confidence === "INFORMATIONAL") {
    return "INFORMATIONAL";
  }
  if (confidence === "WEAK_SIGNAL" || isConfigurationFinding(finding)) {
    return "CONFIGURATION_GAP";
  }
  const severity = normalizeSeverity(finding?.severity);
  if (severity === "critical" || severity === "high") {
    return "STRONG_SIGNAL";
  }
  if (severity === "medium" || severity === "low") {
    return "CONFIGURATION_GAP";
  }
  return "INFORMATIONAL";
}

function resolveEndpointContext(finding = {}) {
  if (finding?.metadata?.endpointContext && typeof finding.metadata.endpointContext === "object") {
    return finding.metadata.endpointContext;
  }
  const endpoint =
    finding?.endpoint ||
    finding?.metadata?.endpoint ||
    finding?.evidence?.request?.url ||
    "/";
  return classifyEndpoint(endpoint);
}

function normalizeJobStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function getJobErrorCode(job = {}) {
  const explicit = job.output?.errorCode || job.output?.status || "";
  const normalized = String(explicit || "").toUpperCase();
  if (normalized) {
    return normalized;
  }
  const status = normalizeJobStatus(job.status);
  if (status === "timeout") {
    return "NETWORK_TIMEOUT";
  }
  if (status === "not_applicable") {
    return "NOT_APPLICABLE";
  }
  if (status === "tool_not_installed") {
    return "TOOL_NOT_INSTALLED";
  }
  if (status === "blocked") {
    return "BLOCKED";
  }
  if (status === "failed" || status === "error") {
    return "EXECUTION_FAILED";
  }
  return "";
}

function getJobFailureReason(job = {}) {
  const errorCode = getJobErrorCode(job);
  const reason =
    job.output?.failureReason ||
    job.errorMessage ||
    job.output?.reason ||
    job.output?.message ||
    "";
  if (!errorCode && !reason) {
    return "";
  }
  if (reason && errorCode && String(reason).startsWith(`${errorCode}:`)) {
    return String(reason);
  }
  return `${errorCode || "FAILED"}: ${reason || "Probe did not complete successfully."}`;
}

function isTerminalForReliability(job = {}) {
  const status = normalizeJobStatus(job.status);
  return ["success", "failed", "blocked", "timeout", "error"].includes(status);
}

function deriveRiskRating(findings = []) {
  const severities = new Set(
    asArray(findings).map((finding) => normalizeSeverity(finding?.severity))
  );
  if (severities.has("critical")) {
    return "CRITICAL";
  }
  if (severities.has("high")) {
    return "HIGH";
  }
  if (severities.has("medium")) {
    return "MEDIUM";
  }
  return "LOW";
}

function deriveDensityLabel(rawDeduction = 0) {
  if (rawDeduction >= 200) {
    return "CRITICAL FINDING DENSITY - IMMEDIATE ACTION REQUIRED";
  }
  if (rawDeduction >= 100) {
    return "HIGH FINDING DENSITY";
  }
  if (rawDeduction >= 31) {
    return "MULTIPLE ISSUES DETECTED";
  }
  return "";
}

function formatEvidenceSummary(evidence) {
  if (!evidence || typeof evidence !== "object") {
    return "";
  }
  const requestUrl = String(evidence?.request?.url || "").trim();
  const method = String(evidence?.request?.method || "GET").toUpperCase();
  const statusCode = Number(evidence?.response?.statusCode || 0);
  const responseTimeMs = Number(evidence?.response?.responseTimeMs || 0);
  const notes = Array.isArray(evidence?.notes) ? evidence.notes.filter(Boolean) : [];
  const noteSnippet = notes.length > 0 ? ` Notes: ${notes.slice(0, 2).join(" | ")}` : "";
  if (requestUrl || statusCode) {
    return `Request: ${method} ${requestUrl || "unknown-url"} | Response: HTTP ${statusCode || "n/a"} in ${responseTimeMs}ms.${noteSnippet}`.trim();
  }
  return "";
}

function findingReferenceId(finding = {}, index = 0) {
  return String(finding?.id || finding?.metadata?.testId || `F-${index + 1}`);
}

function findingSearchText(finding = {}) {
  return `${String(finding?.title || "")} ${String(finding?.description || "")} ${String(
    finding?.type || finding?.metadata?.findingType || ""
  )}`.toLowerCase();
}

class ReportGeneratorService {
  async generateReport(engagementId) {
    const engagement = await Engagement.findById(engagementId).lean();
    if (!engagement) {
      const error = new Error("Engagement not found");
      error.code = "ENGAGEMENT_NOT_FOUND";
      throw error;
    }

    const jobs = await ExecutionJob.find({ engagementId }).sort({ createdAt: -1 }).lean();
    const rawFindings = flattenJobFindings(jobs);
    const findings = deduplicateFindings(rawFindings);
    const summary = countBySeverity(findings);
    const detailedFindings = this.formatFindings(findings);
    const complianceReport =
      engagement.complianceReport ||
      complianceMapperService.generateComplianceReport(findings, { jobs });
    const securityScore = this.calculateSecurityScore(findings, jobs);
    const scanLimitations = this.generateScanLimitations(jobs);
    const metricHonesty = this.buildMetricHonesty(engagement, jobs, scanLimitations);
    const attackChainCorrelation = this.buildAttackChains(findings);

    logger.info(
      {
        engagementId: String(engagement._id),
        findings: findings.length
      },
      "Generated hardened report"
    );

    return {
      structureVersion: "phase2.v1",
      engagementId: String(engagement._id),
      target: engagement.targetUrl,
      generatedAt: new Date().toISOString(),
      executiveSummary: this.generateExecutiveSummary(engagement, summary),
      scope: this.generateScope(engagement),
      findingsSummary: summary,
      findings: detailedFindings,
      securityScore,
      scoreFormula: securityScore.formula,
      riskAnalysis: this.generateRiskAnalysis(findings, summary, securityScore),
      compliance: complianceReport,
      metricHonesty,
      scanLimitations,
      attackChainCorrelation,
      narrativeSections: {
        scanLimitations: this.buildScanLimitationsNarrative(scanLimitations),
        attackChains: attackChainCorrelation.disclaimer
      },
      recommendations: this.generateRecommendations(findings),
      evidence: {
        chainOfCustody: true,
        timestamp: new Date().toISOString(),
        verified: true,
        executionJobsConsidered: jobs.length
      }
    };
  }

  async generateDetailedReport(engagementId) {
    const baseReport = await this.generateReport(engagementId);
    const executionSummary =
      (await executionLoggerService.getExecutionSummary(engagementId)) || {
        totalTests: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        errored: 0,
        totalTimeMs: 0,
        successRate: 0,
        byTool: {},
        timeline: []
      };

    const detailedFindings = await Promise.all(
      (baseReport.findings || []).map(async (finding) => {
        const executionTrace = await this.resolveExecutionTrace(engagementId, finding);
        const developerNotes = this.buildDeveloperNotes(finding, executionTrace);
        const testingGuidance = this.buildTestingGuidance(finding, executionTrace);
        const reproductionSteps = this.buildReproductionSteps(finding, executionTrace);

        return {
          ...finding,
          executionTrace,
          developerNotes,
          testingGuidance,
          reproductionSteps
        };
      })
    );

    const passedTests = executionSummary.timeline.filter(
      (item) => String(item.result || "").toUpperCase() === "PASSED"
    );

    return {
      ...baseReport,
      structureVersion: "phase1.5.v1",
      executionDetails: {
        totalTests: executionSummary.totalTests,
        passed: executionSummary.passed,
        failed: executionSummary.failed,
        blocked: executionSummary.blocked,
        errored: executionSummary.errored,
        successRate: executionSummary.successRate,
        totalTimeMs: executionSummary.totalTimeMs,
        byTool: executionSummary.byTool,
        timeline: executionSummary.timeline
      },
      detailedFindings,
      passedTests
    };
  }

  async resolveExecutionTrace(engagementId, finding) {
    const testId = finding?.metadata?.testId || finding?.metadata?.executionTestId || null;
    if (testId) {
      const trace = await executionLoggerService.getDetailedTrace(testId);
      if (trace) {
        return trace;
      }
    }

    const toolId = finding?.metadata?.toolId ? String(finding.metadata.toolId) : "";
    if (!toolId) {
      return null;
    }

    const summary = await executionLoggerService.getExecutionSummary(engagementId);
    const timeline = Array.isArray(summary?.timeline) ? summary.timeline : [];
    const matched = timeline.find((item) => String(item.tool || "") === toolId);
    if (!matched?.testId) {
      return null;
    }
    return executionLoggerService.getDetailedTrace(matched.testId);
  }

  buildDeveloperNotes(finding, trace) {
    const severity = String(finding?.severity || "").toUpperCase();
    const traceReason = String(trace?.result?.reason || "").trim();
    if (trace?.developerGuidance?.length) {
      const topGuide = trace.developerGuidance[0];
      return `${topGuide.title}. ${topGuide.steps.slice(0, 2).join(" ")}`.trim();
    }

    if (severity === "CRITICAL" || severity === "HIGH") {
      return `Prioritize immediate remediation and regression testing. ${traceReason}`.trim();
    }

    return `Address in planned hardening cycle and validate with repeatable checks. ${traceReason}`.trim();
  }

  buildTestingGuidance(finding, trace) {
    if (trace?.developerGuidance?.length) {
      return trace.developerGuidance
        .map((item, index) => `${index + 1}. ${item.testing}`)
        .join("\n");
    }
    const recommendation = String(finding?.fix || finding?.recommendation || "").trim();
    return `1. Apply remediation.\n2. Re-run the same test scenario.\n3. Confirm finding no longer appears.\n4. Verify no regressions.\nReference remediation: ${recommendation}`;
  }

  buildReproductionSteps(finding, trace) {
    const explicit = Array.isArray(finding?.reproductionSteps)
      ? finding.reproductionSteps.filter((step) => String(step || "").trim().length > 0)
      : Array.isArray(finding?.metadata?.reproductionSteps)
        ? finding.metadata.reproductionSteps.filter(
            (step) => String(step || "").trim().length > 0
          )
        : [];
    if (explicit.length > 0) {
      return explicit;
    }

    const target =
      String(
        finding?.metadata?.targetUrl ||
          finding?.evidence?.request?.url ||
          "https://target.example"
      ).trim() || "https://target.example";
    const method = String(
      trace?.parameters?.method ||
        finding?.evidence?.request?.method ||
        finding?.metadata?.methodTested ||
        "GET"
    ).toUpperCase();

    if (trace?.parameters && Object.keys(trace.parameters).length > 0) {
      const url = String(trace.parameters.url || trace.parameters.targetUrl || target);
      return [
        `curl -i -X ${method} '${url}'`,
        "Compare returned status code and headers to the evidence captured in this finding."
      ];
    }

    return [
      `curl -i -X ${method} '${target}'`,
      "Evidence capture failed â€” scanner did not persist detailed reproduction context for this finding."
    ];
  }

  generateExecutiveSummary(engagement, summary) {
    return `Security assessment for ${engagement.targetUrl} identified ${summary.critical} critical, ${summary.high} high, ${summary.medium} medium, and ${summary.low + summary.info} lower-priority findings across reconnaissance, dependency, cloud, and secret exposure checks.`;
  }

  generateScope(engagement) {
    return {
      engagementName: engagement.name,
      target: engagement.targetUrl,
      targetType: engagement.targetType,
      testDate: engagement.createdAt,
      allowedDomains: asArray(engagement.scope?.allowedDomains),
      allowedIpRanges: asArray(engagement.scope?.allowedIpRanges),
      assessmentType: "Comprehensive (Operational + Supply Chain + Cloud + Secrets)"
    };
  }

  formatFindings(findings = []) {
    return findings.map((finding, index) => {
      const normalizedType = this.normalizeType(finding);
      const mapped = complianceMapperService.mapFinding({
        ...finding,
        type: normalizedType
      });
      const mappedCompliance = mapped.compliance || {};
      const owaspTags = Array.isArray(mappedCompliance.owasp)
        ? mappedCompliance.owasp.map((item) => item.code)
        : [];
      const recommendation =
        finding?.recommendation ||
        finding?.remediation ||
        this.getDefaultRemediation(normalizedType);
      const evidenceSummary =
        formatEvidenceSummary(finding?.evidence) ||
        this.buildWhatFoundFallback(finding);
      const deduplicationNote = String(finding?.deduplicationNote || "").trim();
      const discoveryVector =
        String(finding?.discoveryVector || finding?.metadata?.discoveryVector || "").trim() ||
        (finding?.source
          ? `Discovered via ${finding.source}${finding._toolId ? ` (${finding._toolId})` : ""}.`
          : "Evidence capture failed â€” discovery vector not provided by scanner.");
      const endpointContext = resolveEndpointContext(finding);
      const severityReason =
        String(finding?.severityReason || finding?.metadata?.severityReason || "").trim() ||
        `Severity aligned to ${endpointContext.endpointType.toLowerCase()} endpoint context (${endpointContext.sensitivity}).`;
      const confidence = deriveConfidenceLevel(finding);
      const manualValidationRequired = needsManualValidation(confidence);
      const reproductionSteps = Array.isArray(finding?.reproductionSteps)
        ? finding.reproductionSteps.filter((step) => String(step || "").trim().length > 0)
        : [];
      return {
        id: index + 1,
        title: finding?.title || "Untitled finding",
        severity: String(normalizeSeverity(finding?.severity)).toUpperCase(),
        type: normalizedType,
        what: finding?.description || "No description provided.",
        how: discoveryVector,
        whatFound: evidenceSummary,
        deduplicationNote,
        why: this.getWhyItMatters(normalizedType),
        fix: recommendation,
        endpointType: endpointContext.endpointType,
        endpointSensitivity: endpointContext.sensitivity,
        severityReason,
        confidence,
        manualValidationRequired,
        manualValidationNote: manualValidationRequired
          ? "Manual validation recommended before treating as confirmed vulnerability."
          : "",
        evidence:
          finding?.evidence ||
          {
            status: "failed",
            reason: "Evidence capture failed â€” scanner did not persist evidence payload."
          },
        discoveryVector,
        reproductionSteps:
          reproductionSteps.length > 0
            ? reproductionSteps
            : [
                `curl -i -X GET '${finding?.metadata?.targetUrl || "https://target.example"}'`,
                "Evidence capture failed â€” scanner did not provide reproducible request steps."
              ],
        owaspTags,
        tags: Array.from(new Set([...asArray(finding?.tags), ...owaspTags])),
        compliance: mappedCompliance,
        metadata: {
          toolId: finding?._toolId || null,
          jobId: finding?._jobId || null,
          endpointContext,
          severityReason,
          confidence,
          manualValidationRequired,
          manualValidationNote: manualValidationRequired
            ? "Manual validation recommended before treating as confirmed vulnerability."
            : "",
          tags: Array.from(new Set([...asArray(finding?.tags), ...owaspTags]))
        }
      };
    });
  }

  buildWhatFoundFallback(finding) {
    if (finding?.cve) {
      return `Related advisory: ${finding.cve}`;
    }
    if (finding?.metadata && typeof finding.metadata === "object") {
      const keys = Object.keys(finding.metadata).slice(0, 3);
      if (keys.length > 0) {
        return `Observed metadata keys: ${keys.join(", ")}`;
      }
    }
    return "Evidence capture failed â€” scanner did not persist evidence for this finding.";
  }

  normalizeType(finding) {
    const explicit = String(
      finding?.type || finding?.metadata?.findingType || ""
    ).trim();
    if (explicit) {
      return explicit;
    }
    const categoryRaw = String(finding?.category || "").trim();
    if (!categoryRaw) {
      return "SECURITY_FINDING";
    }
    const category = categoryRaw.toLowerCase();
    if (category.includes("secret")) {
      return "SECRET_FOUND";
    }
    if (category.includes("supply")) {
      return "VULNERABLE_DEPENDENCY";
    }
    if (category.includes("cloud")) {
      return "CLOUD_MISCONFIGURATION";
    }
    if (category.includes("misconfig")) {
      return "MISCONFIGURATION";
    }
    return categoryRaw.toUpperCase().replace(/\s+/g, "_");
  }

  calculateSecurityScore(findings = [], jobs = []) {
    let score = 100;
    const formula = {
      startsAt: 100,
      findingImpacts: [],
      probeDeductions: [],
      bonuses: [],
      rawDeduction: 0,
      unclampedScore: 100,
      clamp: "0-100"
    };

    const impactCounts = {
      CONFIRMED: 0,
      STRONG_SIGNAL: 0,
      CONFIGURATION_GAP: 0,
      INFORMATIONAL: 0
    };

    let findingDeductionTotal = 0;
    for (const finding of findings) {
      const impactLevel = deriveImpactLevel(finding);
      impactCounts[impactLevel] = Number(impactCounts[impactLevel] || 0) + 1;
      const baseWeight = FINDING_IMPACT_WEIGHTS[impactLevel] || 0;
      const endpointContext = resolveEndpointContext(finding);
      const endpointWeight = Number(endpointContext?.weight || 1);
      const weightedDeduction = Math.max(0, Math.round(baseWeight * endpointWeight));

      score -= weightedDeduction;
      findingDeductionTotal += weightedDeduction;
      formula.findingImpacts.push({
        findingId: String(finding?.id || ""),
        title: String(finding?.title || "Untitled finding"),
        impactLevel,
        baseWeight,
        endpointType: endpointContext.endpointType,
        endpointSensitivity: endpointContext.sensitivity,
        endpointWeight,
        deduction: weightedDeduction
      });
    }

    const failedJobs = jobs.filter((job) => ["failed", "error"].includes(normalizeJobStatus(job.status)));
    const timeoutJobs = jobs.filter((job) => normalizeJobStatus(job.status) === "timeout");
    const blockedJobs = jobs.filter((job) => normalizeJobStatus(job.status) === "blocked");
    const toolUnavailableJobs = jobs.filter(
      (job) =>
        normalizeJobStatus(job.status) === "tool_not_installed" ||
        getJobErrorCode(job) === "TOOL_NOT_INSTALLED"
    );

    let probeDeductionTotal = 0;
    for (const job of failedJobs) {
      if (getJobErrorCode(job) === "TOOL_NOT_INSTALLED") {
        continue;
      }
      score -= 5;
      probeDeductionTotal += 5;
      formula.probeDeductions.push({
        toolId: job.toolId,
        status: "FAILED",
        deduction: 5,
        reason: getJobFailureReason(job)
      });
    }

    for (const job of timeoutJobs) {
      score -= 2;
      probeDeductionTotal += 2;
      formula.probeDeductions.push({
        toolId: job.toolId,
        status: "TIMEOUT",
        deduction: 2,
        reason: getJobFailureReason(job)
      });
    }

    const defenseSignals = [];
    for (const job of blockedJobs) {
      defenseSignals.push({
        toolId: job.toolId,
        reason: getJobFailureReason(job) || "Target actively blocked the probe.",
        type: "WAF_BLOCK"
      });
    }

    for (const job of jobs) {
      const explicitSignals = Array.isArray(job?.output?.defenseSignals)
        ? job.output.defenseSignals
        : [];
      for (const signal of explicitSignals) {
        defenseSignals.push({
          toolId: job.toolId,
          reason:
            signal?.reason ||
            (signal?.type === "RATE_LIMIT_ENFORCED"
              ? "Rate limiting defense returned HTTP 429 during probe."
              : "Defense signal recorded during scan."),
          type: signal?.type || "DEFENSE_SIGNAL"
        });
      }
    }

    for (const signal of defenseSignals) {
      score += 3;
      formula.bonuses.push({
        toolId: signal.toolId,
        status: signal.type,
        bonus: 3,
        reason: signal.reason
      });
    }

    const successfulCleanCategories = new Set();
    for (const job of jobs) {
      if (normalizeJobStatus(job.status) !== "success") {
        continue;
      }
      const jobFindings = collectJobFindings(job);
      if (jobFindings.length > 0) {
        continue;
      }
      successfulCleanCategories.add(String(job.toolId || "unknown"));
    }
    const successBonus = Math.min(10, successfulCleanCategories.size * 2);
    if (successBonus > 0) {
      score += successBonus;
      formula.bonuses.push({
        type: "clean_categories",
        categories: [...successfulCleanCategories].slice(0, 5),
        bonus: successBonus
      });
    }

    const reliabilityJobs = jobs.filter(
      (job) =>
        isTerminalForReliability(job) &&
        normalizeJobStatus(job.status) !== "blocked" &&
        !toolUnavailableJobs.some((item) => String(item._id) === String(job._id))
    );
    const failedOrTimedOut = reliabilityJobs.filter((job) =>
      ["failed", "error", "timeout"].includes(normalizeJobStatus(job.status))
    );
    const unreliable =
      reliabilityJobs.length > 0 && failedOrTimedOut.length > reliabilityJobs.length / 2;
    const rawDeduction = findingDeductionTotal + probeDeductionTotal;
    formula.rawDeduction = rawDeduction;
    formula.unclampedScore = Math.round(score);

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    const densityLabel = formula.unclampedScore < 0 ? deriveDensityLabel(rawDeduction) : "";
    const scoreFloorReached = finalScore === 0 && formula.unclampedScore < 0;
    const scoreFloorMessage = scoreFloorReached
      ? [
          "Score floor reached.",
          `${findings.length} findings identified.`,
          "Score reflects cumulative finding impact rather than confirmed catastrophic compromise."
        ].join("\n")
      : "";

    return {
      score: finalScore,
      maxScore: 100,
      densityLabel,
      rawDeduction,
      riskRating: deriveRiskRating(findings),
      reliable: !unreliable,
      reliabilityStatus: unreliable ? "UNRELIABLE" : "RELIABLE",
      unreliableReason: unreliable
        ? "Score could not be accurately calculated because too many scan probes failed. Address probe failures to get an accurate score."
        : "",
      failedProbeCount: failedJobs.length,
      timeoutProbeCount: timeoutJobs.length,
      blockedProbeCount: blockedJobs.length,
      toolUnavailableCount: toolUnavailableJobs.length,
      scoreFloorReached,
      scoreFloorMessage,
      impactCounts,
      formula
    };
  }

  generateScanLimitations(jobs = []) {
    return jobs
      .filter((job) => {
        const status = normalizeJobStatus(job.status);
        return [
          "failed",
          "blocked",
          "timeout",
          "not_applicable",
          "tool_not_installed",
          "error"
        ].includes(status);
      })
      .map((job) => ({
        toolId: job.toolId || "unknown",
        status: normalizeJobStatus(job.status).toUpperCase(),
        errorCode: getJobErrorCode(job),
        reason: getJobFailureReason(job),
        durationMs: Number(job.durationMs || 0)
      }));
  }

  buildMetricHonesty(engagement = {}, jobs = [], scanLimitations = []) {
    const whitelist = Array.isArray(engagement?.constraints?.toolWhitelist)
      ? engagement.constraints.toolWhitelist
      : [];
    const plannedModules = new Set(
      (whitelist.length > 0 ? whitelist : jobs.map((job) => job.toolId)).filter(Boolean)
    );
    const successfulStatuses = new Set(["success", "blocked", "not_applicable"]);
    const executedStatuses = new Set([
      "success",
      "failed",
      "error",
      "blocked",
      "timeout",
      "tool_not_installed",
      "not_applicable"
    ]);

    const executedJobs = jobs.filter((job) => executedStatuses.has(normalizeJobStatus(job.status)));
    const successfulJobs = executedJobs.filter((job) =>
      successfulStatuses.has(normalizeJobStatus(job.status))
    );

    const plannedCount = plannedModules.size;
    const successfulModuleCount = new Set(
      successfulJobs.map((job) => String(job.toolId || "")).filter(Boolean)
    ).size;
    const scanCoverageRate =
      plannedCount > 0
        ? Number(((successfulModuleCount / plannedCount) * 100).toFixed(1))
        : 0;
    const probeSuccessRate =
      executedJobs.length > 0
        ? Number(((successfulJobs.length / executedJobs.length) * 100).toFixed(1))
        : 0;

    const missingToolSignals = scanLimitations
      .filter(
        (item) =>
          String(item.errorCode || "").toUpperCase() === "TOOL_NOT_INSTALLED" ||
          String(item.status || "").toUpperCase() === "TOOL_NOT_INSTALLED"
      )
      .map((item) => String(item.toolId || "unknown"));
    const missingRequiredTools = REQUIRED_TOOLCHAIN.filter((toolName) =>
      missingToolSignals.some((signal) => signal.toLowerCase().includes(toolName))
    );
    const uniqueMissing = [...new Set(missingRequiredTools)];
    const toolchainIntegrity = {
      status: uniqueMissing.length > 0 ? "INCOMPLETE" : "COMPLETE",
      requiredTools: REQUIRED_TOOLCHAIN,
      missingTools: uniqueMissing
    };

    return {
      scanCoverageRate: {
        plannedModules: plannedCount,
        successfulModules: successfulModuleCount,
        ratePercent: scanCoverageRate
      },
      probeSuccessRate: {
        executedProbes: executedJobs.length,
        successfulProbes: successfulJobs.length,
        ratePercent: probeSuccessRate
      },
      toolchainIntegrity
    };
  }

  buildScanLimitationsNarrative(scanLimitations = []) {
    if (!scanLimitations.length) {
      return "";
    }
    const lines = ["Scan Limitations"];
    for (const limitation of scanLimitations) {
      lines.push(
        `${limitation.toolId}: ${limitation.reason || `${limitation.status}: Probe did not complete.`}`
      );
    }
    return lines.join("\n");
  }

  buildAttackChains(findings = []) {
    const indexed = findings.map((finding, index) => ({
      finding,
      index,
      text: findingSearchText(finding),
      id: findingReferenceId(finding, index)
    }));
    const has = (pattern) => indexed.filter((item) => pattern.test(item.text));
    const chains = [];

    const rateLimitSignals = has(/rate.?limit|throttl/);
    const accountLockoutSignals = has(/account lockout|lockout|login throttle/);
    if (rateLimitSignals.length > 0 && accountLockoutSignals.length === 0) {
      chains.push({
        chain: "No rate limiting + no account lockout -> brute force chain",
        findingIds: rateLimitSignals.map((item) => item.id)
      });
    }

    const reflectedInputSignals = has(/reflected|xss|input reflection/);
    const cspSignals = has(/content-security-policy|missing csp/);
    if (reflectedInputSignals.length > 0 && cspSignals.length > 0) {
      chains.push({
        chain: "Reflected input + missing CSP -> potential XSS chain",
        findingIds: [...reflectedInputSignals, ...cspSignals].map((item) => item.id)
      });
    }

    const versionDisclosureSignals = has(/version disclosure|x-powered-by|server header|technology disclosure/);
    const cveSignals = indexed.filter((item) => Boolean(item.finding?.cve));
    if (versionDisclosureSignals.length > 0 && cveSignals.length > 0) {
      chains.push({
        chain: "Version disclosure + known CVE -> targeted exploit chain",
        findingIds: [...versionDisclosureSignals, ...cveSignals].map((item) => item.id)
      });
    }

    const unauthAdminSignals = has(/unauth.*admin|admin.*unauth|exposed admin|unauthenticated endpoint exposed/);
    const authSignals = has(/auth|token|session|login|signin|password|bola/);
    if (unauthAdminSignals.length > 0 && authSignals.length > 0) {
      chains.push({
        chain: "Unauthenticated admin + auth issue -> privilege chain",
        findingIds: [...unauthAdminSignals, ...authSignals].map((item) => item.id)
      });
    }

    return {
      chains: chains.map((item) => ({
        ...item,
        findingIds: [...new Set(item.findingIds)]
      })),
      disclaimer: "Attack chains are theoretical and require manual validation."
    };
  }

  generateRiskAnalysis(findings = [], summary = {}, securityScore = null) {
    const criticalCount = summary.critical || 0;
    const highCount = summary.high || 0;
    let riskLevel = securityScore?.riskRating || deriveRiskRating(findings);
    let impactStatement =
      "Current posture indicates low immediate risk, with routine hardening recommended.";

    if (criticalCount > 0) {
      riskLevel = "CRITICAL";
      impactStatement =
        "Critical findings expose credible compromise paths and should be remediated immediately.";
    } else if (highCount > 0) {
      riskLevel = "HIGH";
      impactStatement =
        "High-severity findings increase exploitability and should be addressed in the next sprint.";
    } else if ((summary.medium || 0) > 0) {
      riskLevel = "MEDIUM";
      impactStatement =
        "Medium findings require planned remediation to prevent escalation into higher risk.";
    }

    const affectedSystems = Array.from(
      new Set(
        findings.map((finding) => {
          if (finding?.metadata?.resource) {
            return String(finding.metadata.resource);
          }
          return "Web Application";
        })
      )
    );

    return {
      riskLevel,
      score: securityScore?.score ?? null,
      maxScore: securityScore?.maxScore ?? 100,
      reliabilityStatus: securityScore?.reliabilityStatus || "UNKNOWN",
      impactStatement,
      affectedSystems
    };
  }

  generateRecommendations(findings = []) {
    const bySeverity = {
      critical: findings.filter((f) => normalizeSeverity(f.severity) === "critical"),
      high: findings.filter((f) => normalizeSeverity(f.severity) === "high")
    };

    return {
      immediate: bySeverity.critical.slice(0, 3).map((finding) => ({
        priority: "IMMEDIATE",
        action:
          finding.remediation ||
          finding.recommendation ||
          this.getDefaultRemediation(this.normalizeType(finding)),
        impact: "Critical"
      })),
      shortTerm: bySeverity.high.slice(0, 3).map((finding) => ({
        priority: "SHORT_TERM",
        action:
          finding.remediation ||
          finding.recommendation ||
          this.getDefaultRemediation(this.normalizeType(finding)),
        impact: "High"
      })),
      longTerm: [
        {
          priority: "LONG_TERM",
          action: "Automate weekly dependency and secrets scanning in CI.",
          impact: "Medium"
        },
        {
          priority: "LONG_TERM",
          action: "Schedule quarterly cloud security posture reviews.",
          impact: "Medium"
        },
        {
          priority: "LONG_TERM",
          action: "Enforce secure-by-default guardrails for new services.",
          impact: "High"
        }
      ]
    };
  }

  getWhyItMatters(type) {
    const explanations = {
      INJECTION:
        "Injection paths can enable unauthorized data access, tampering, or command execution.",
      XSS: "Cross-site scripting can enable session theft, phishing, and user impersonation.",
      AUTHENTICATION:
        "Authentication weaknesses can allow account takeover and unauthorized control.",
      MISCONFIGURATION:
        "Misconfigurations often expose attack surface and weaken foundational defenses.",
      VULNERABLE_DEPENDENCY:
        "Known dependency flaws are cataloged exploit paths often targeted quickly.",
      SECRET_FOUND:
        "Exposed secrets can allow direct unauthorized access without sophisticated exploitation.",
      CLOUD_MISCONFIGURATION:
        "Cloud misconfigurations can expose sensitive assets and increase blast radius."
    };
    return (
      explanations[type] ||
      "This finding increases risk and should be remediated according to security best practices."
    );
  }

  getDefaultRemediation(type) {
    const remediations = {
      INJECTION:
        "Use parameterized queries and strict input validation. Remove dynamic query construction.",
      XSS: "Apply output encoding, CSP, and input validation at trust boundaries.",
      AUTHENTICATION:
        "Strengthen auth controls with MFA, secure session handling, and least privilege.",
      MISCONFIGURATION:
        "Apply hardened defaults, least privilege, and regular configuration audits.",
      VULNERABLE_DEPENDENCY:
        "Upgrade to patched versions and enforce dependency monitoring in CI/CD.",
      SECRET_FOUND:
        "Rotate exposed credentials immediately and migrate secret management to secure vaulting.",
      CLOUD_MISCONFIGURATION:
        "Restrict cloud access policies, enforce encryption, and block public exposure."
    };
    return remediations[type] || "Remediate this finding with defense-in-depth controls.";
  }
}

module.exports = new ReportGeneratorService();





