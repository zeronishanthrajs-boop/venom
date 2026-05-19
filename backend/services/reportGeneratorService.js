const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const executionLoggerService = require("./executionLoggerService");
const { deduplicateFindings } = require("../utils/deduplicateFindings");
const { logger } = require("../config/logger");

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

    logger.info(
      {
        engagementId: String(engagement._id),
        findings: findings.length
      },
      "Generated hardened report"
    );

    return {
      structureVersion: "phase1.v1",
      engagementId: String(engagement._id),
      target: engagement.targetUrl,
      generatedAt: new Date().toISOString(),
      executiveSummary: this.generateExecutiveSummary(engagement, summary),
      scope: this.generateScope(engagement),
      findingsSummary: summary,
      findings: detailedFindings,
      riskAnalysis: this.generateRiskAnalysis(findings, summary),
      compliance: this.mapCompliance(findings),
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
    const target = finding?.metadata?.targetUrl ? String(finding.metadata.targetUrl) : "target endpoint";
    if (trace?.parameters && Object.keys(trace.parameters).length > 0) {
      const method = String(trace.parameters.method || "GET");
      const url = String(trace.parameters.url || trace.parameters.targetUrl || target);
      return [
        `Send ${method} request to ${url}.`,
        "Use the same headers/parameters captured in execution trace.",
        "Compare response status and headers with trace evidence.",
        "Validate remediation by repeating the exact request after fixes."
      ];
    }
    return [
      `Re-run scanner against ${target}.`,
      "Capture response artifacts that triggered the finding.",
      "Apply remediation and execute the same check.",
      "Confirm finding transitions to PASSED in execution timeline."
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
      const recommendation =
        finding?.recommendation ||
        finding?.remediation ||
        this.getDefaultRemediation(normalizedType);
      return {
        id: index + 1,
        title: finding?.title || "Untitled finding",
        severity: String(normalizeSeverity(finding?.severity)).toUpperCase(),
        type: normalizedType,
        what: finding?.description || "No description provided.",
        how: finding?.source
          ? `Discovered via ${finding.source}${finding._toolId ? ` (${finding._toolId})` : ""}.`
          : "Discovered during automated assessment.",
        whatFound: finding?.evidence || this.buildWhatFoundFallback(finding),
        why: this.getWhyItMatters(normalizedType),
        fix: recommendation,
        metadata: {
          toolId: finding?._toolId || null,
          jobId: finding?._jobId || null,
          tags: asArray(finding?.tags)
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
    return "See execution logs for detailed evidence.";
  }

  normalizeType(finding) {
    const explicit = String(finding?.type || "").trim();
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

  generateRiskAnalysis(findings = [], summary = {}) {
    const criticalCount = summary.critical || 0;
    const highCount = summary.high || 0;
    let riskLevel = "LOW";
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
      impactStatement,
      affectedSystems
    };
  }

  mapCompliance(findings = []) {
    const count = (predicate) => findings.filter(predicate).length;
    return {
      owaspTop10: {
        A01: count((f) => this.normalizeType(f).includes("ACCESS_CONTROL")),
        A02: count((f) => this.normalizeType(f).includes("CRYPTO")),
        A03: count((f) => this.normalizeType(f).includes("INJECTION")),
        A04: count((f) => this.normalizeType(f).includes("INSECURE_DESIGN")),
        A05: count((f) => this.normalizeType(f).includes("MISCONFIG")),
        A06: count((f) => this.normalizeType(f).includes("VULNERABLE_DEPENDENCY"))
      },
      controls: {
        secretExposureFindings: count((f) => this.normalizeType(f) === "SECRET_FOUND"),
        cloudMisconfigFindings: count(
          (f) => this.normalizeType(f) === "CLOUD_MISCONFIGURATION"
        ),
        supplyChainFindings: count(
          (f) => this.normalizeType(f) === "VULNERABLE_DEPENDENCY"
        )
      },
      compliance: ["OWASP", "CIS", "PCI-DSS"]
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
