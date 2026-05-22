const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const handlebars = require("handlebars");
const nodemailer = require("nodemailer");

const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const Plan = require("../models/Plan");
const { generateComplianceSummary } = require("./complianceMapper");
const { deduplicateFindings } = require("../utils/deduplicateFindings");
const { callGeminiText } = require("./geminiClient");
const reportGeneratorService = require("./reportGeneratorService");
const { deriveConfidenceLevel, needsManualValidation } = require("../utils/confidenceModel");

const TEMPLATE_PATH = path.join(__dirname, "../templates/report.html");

const SEVERITY_CLASS = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info"
};

const RISK_BANNER_COLOR = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#65a30d",
  clean: "#16a34a",
  unknown: "#64748b"
};

function maskEmail(value) {
  const text = String(value || "").trim().toLowerCase();
  const atIndex = text.indexOf("@");
  if (atIndex <= 1) {
    return text || "unknown";
  }
  const local = text.slice(0, atIndex);
  const domain = text.slice(atIndex + 1);
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function redactTargetUrl(value) {
  if (!value) {
    return "n/a";
  }
  try {
    const parsed = new URL(String(value));
    return `${parsed.protocol}//${parsed.host}/[redacted]`;
  } catch {
    return String(value);
  }
}

function resolveLocalChromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function flattenFindings(jobs = []) {
  return jobs.flatMap((job) => {
    const outputFindings = Array.isArray(job.output?.findings)
      ? job.output.findings
      : [];
    const topFindings = Array.isArray(job.findings) ? job.findings : [];
    if (outputFindings.length > 0) {
      const outputHasTranslations = outputFindings.some(
        (finding) =>
          Boolean(finding?.translations?.founder) ||
          Boolean(finding?.translations?.engineer) ||
          Boolean(finding?.translations?.brief)
      );
      if (outputHasTranslations || topFindings.length === 0) {
        return outputFindings;
      }
    }
    if (topFindings.length > 0) {
      return topFindings;
    }
    return [];
  });
}

function computeSeverityBreakdown(findings = []) {
  return {
    critical: findings.filter((item) => String(item.severity).toLowerCase() === "critical")
      .length,
    high: findings.filter((item) => String(item.severity).toLowerCase() === "high").length,
    medium: findings.filter((item) => String(item.severity).toLowerCase() === "medium")
      .length,
    low: findings.filter((item) => String(item.severity).toLowerCase() === "low").length,
    info: findings.filter((item) => String(item.severity).toLowerCase() === "info").length
  };
}

function sanitizeFileName(value) {
  return String(value || "engagement")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "engagement";
}

function formatDate(value) {
  if (!value) {
    return "n/a";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "n/a";
  }
  return parsed.toISOString();
}

function buildExecutionSummary(jobs = []) {
  const totalJobs = jobs.length;
  const statusOf = (job) => String(job.status || "").toLowerCase();
  const terminalStatuses = new Set([
    "success",
    "failed",
    "blocked",
    "timeout",
    "killed",
    "error",
    "tool_not_installed",
    "not_applicable"
  ]);
  const successStatuses = new Set(["success", "blocked", "not_applicable"]);

  const completedJobs = jobs.filter((job) => successStatuses.has(statusOf(job)));
  const failedJobs = jobs.filter((job) =>
    ["failed", "timeout", "killed", "error", "tool_not_installed"].includes(statusOf(job))
  );
  const terminalJobs = jobs.filter((job) => terminalStatuses.has(statusOf(job)));
  const probeSuccessRate =
    terminalJobs.length > 0
      ? Math.round((completedJobs.length / terminalJobs.length) * 100)
      : 0;

  const modules = new Map();
  for (const job of jobs) {
    const key = String(job.toolId || "").trim();
    if (!key || modules.has(key)) {
      continue;
    }
    modules.set(key, statusOf(job));
  }
  const plannedModules = modules.size;
  const successfulModules = Array.from(modules.values()).filter((status) =>
    successStatuses.has(status)
  ).length;
  const scanCoverageRate =
    plannedModules > 0 ? Math.round((successfulModules / plannedModules) * 100) : 0;

  const avgDurationMs =
    completedJobs.length > 0
      ? Math.round(
          completedJobs.reduce((sum, job) => sum + Number(job.durationMs || 0), 0) /
            completedJobs.length
        )
      : 0;
  const missingTools = jobs
    .filter((job) => statusOf(job) === "tool_not_installed")
    .map((job) => String(job.toolId || "unknown"));

  return {
    totalJobs,
    completedJobs: completedJobs.length,
    failedJobs: failedJobs.length,
    successRate: probeSuccessRate,
    avgDurationMs,
    metricHonesty: {
      scanCoverageRate: {
        plannedModules,
        successfulModules,
        ratePercent: scanCoverageRate
      },
      probeSuccessRate: {
        executedProbes: terminalJobs.length,
        successfulProbes: completedJobs.length,
        ratePercent: probeSuccessRate
      },
      toolchainIntegrity: {
        status: missingTools.length > 0 ? "INCOMPLETE" : "COMPLETE",
        missingTools: [...new Set(missingTools)]
      }
    }
  };
}

function normalizeJobStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function collectJobFindings(job = {}) {
  if (Array.isArray(job.findings) && job.findings.length > 0) {
    return job.findings;
  }
  return Array.isArray(job.output?.findings) ? job.output.findings : [];
}

function jobFailureReason(job = {}) {
  const status = normalizeJobStatus(job.status).toUpperCase() || "FAILED";
  return (
    job.output?.failureReason ||
    job.errorMessage ||
    job.output?.reason ||
    `${status}: Probe did not complete successfully.`
  );
}

function riskFromFindings(findings = []) {
  const severities = new Set(
    (Array.isArray(findings) ? findings : []).map((finding) =>
      String(finding?.severity || "").toLowerCase()
    )
  );
  if (severities.has("critical")) return "CRITICAL";
  if (severities.has("high")) return "HIGH";
  if (severities.has("medium")) return "MEDIUM";
  return "LOW";
}

function deriveDensityLabel(rawDeduction = 0) {
  if (rawDeduction >= 200) return "CRITICAL FINDING DENSITY — IMMEDIATE ACTION REQUIRED";
  if (rawDeduction >= 100) return "HIGH FINDING DENSITY";
  if (rawDeduction >= 31) return "MULTIPLE ISSUES DETECTED";
  return "";
}

function calculateSecurityScore(findings = [], jobs = []) {
  return reportGeneratorService.calculateSecurityScore(findings, jobs);
}

function buildScanLimitations(jobs = []) {
  return jobs
    .filter((job) =>
      ["failed", "blocked", "timeout", "not_applicable", "tool_not_installed", "error"].includes(
        normalizeJobStatus(job.status)
      )
    )
    .map((job) => ({
      tool: job.toolId || "scan",
      status: normalizeJobStatus(job.status).toUpperCase(),
      reason: jobFailureReason(job)
    }));
}

// Handlebars helpers registration
if (!handlebars.helpers.eq) {
  handlebars.registerHelper("eq", function (a, b) {
    return a === b;
  });
}
if (!handlebars.helpers.gt) {
  handlebars.registerHelper("gt", function (a, b) {
    return Number(a) > Number(b);
  });
}

const NARRATIVE_DISCLAIMER =
  "This narrative describes risks supported by observed findings only.\nAdditional attack vectors may require deeper manual testing.";

function findingRef(finding = {}, index = 0) {
  return String(finding.id || `F-${index + 1}`);
}

function findingText(finding = {}) {
  return `${String(finding?.title || "")} ${String(finding?.type || "")} ${String(finding?.category || "")} ${String(finding?.description || "")}`.toLowerCase();
}

function hasSignal(findings = [], matcher) {
  return findings.some((finding, index) => matcher(findingText(finding), finding, index));
}

function collectFindingIds(findings = [], matcher) {
  return findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding, index }) => matcher(findingText(finding), finding, index))
    .map(({ finding, index }) => findingRef(finding, index));
}

function generateHeuristicAttackNarrative(findings, targetUrl) {
  if (!findings || findings.length === 0) {
    return `No significant exploitable chain is supported by the current findings for ${targetUrl}.\n\n${NARRATIVE_DISCLAIMER}`;
  }

  const topFindings = findings.slice(0, 3).map((finding, index) => ({
    id: findingRef(finding, index),
    title: String(finding.title || "Untitled finding"),
    severity: String(finding.severity || "low").toUpperCase()
  }));

  const narrativeParts = [
    `Observed risk signals for ${targetUrl} include ${topFindings
      .map((item) => `${item.id} (${item.severity}): ${item.title}`)
      .join("; ")}.`
  ];

  const hasAuthWeakness = hasSignal(
    findings,
    (text) => /auth|token|session|login|signin|register|password|bola|unauth/.test(text)
  );
  const hasNoRateLimit = hasSignal(findings, (text) => /rate.?limit|throttl/.test(text));
  const hasReflection = hasSignal(findings, (text) => /reflected|xss|input reflection/.test(text));
  const hasMissingCsp = hasSignal(
    findings,
    (text) => /content-security-policy|missing csp|csp/.test(text)
  );
  const hasSqli = hasSignal(findings, (text) => /sql.?injection|sql error/.test(text));
  const hasNetworkExposure = hasSignal(
    findings,
    (text) => /open port|network exposure|internal|service exposure/.test(text)
  );
  const hasVersionDisclosure = hasSignal(
    findings,
    (text) => /version disclosure|x-powered-by|server header|technology disclosure/.test(text)
  );
  const hasKnownCve = hasSignal(findings, (_text, finding) => Boolean(finding?.cve));

  if (hasAuthWeakness && hasNoRateLimit) {
    const ids = collectFindingIds(
      findings,
      (text) => /auth|token|session|login|signin|register|password|bola|unauth|rate.?limit|throttl/.test(text)
    );
    narrativeParts.push(
      `A brute-force style chain is plausible where authentication weaknesses combine with weak request throttling controls. [Finding IDs: ${ids.join(", ")}]`
    );
  }

  if (hasReflection && hasMissingCsp) {
    const ids = collectFindingIds(
      findings,
      (text) => /reflected|xss|input reflection|content-security-policy|missing csp|csp/.test(text)
    );
    narrativeParts.push(
      `Potential reflected-input abuse could become more practical when browser script policy controls are absent. [Finding IDs: ${ids.join(", ")}]`
    );
  }

  if (hasVersionDisclosure && hasKnownCve) {
    const ids = collectFindingIds(
      findings,
      (text, finding) => /version disclosure|x-powered-by|server header|technology disclosure/.test(text) || Boolean(finding?.cve)
    );
    narrativeParts.push(
      `Version and component disclosure can improve exploit targeting when known vulnerable components are also present. [Finding IDs: ${ids.join(", ")}]`
    );
  }

  if (hasSqli && hasNetworkExposure) {
    const ids = collectFindingIds(
      findings,
      (text) => /sql.?injection|sql error|open port|network exposure|internal|service exposure/.test(text)
    );
    narrativeParts.push(
      `Data-layer compromise risk may increase where injection signals coexist with exposed service surfaces. [Finding IDs: ${ids.join(", ")}]`
    );
  }

  if (narrativeParts.length === 1) {
    const ids = findings.map((finding, index) => findingRef(finding, index));
    narrativeParts.push(
      `No stronger multi-step chain is supported beyond the observed findings. Prioritize direct remediation and re-test each issue. [Finding IDs: ${ids.join(", ")}]`
    );
  }

  narrativeParts.push(NARRATIVE_DISCLAIMER);
  return narrativeParts.join("\n\n");
}

async function generateAttackNarrative(findings, targetUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || process.env.ENABLE_ATTACK_NARRATIVE_AI === "false" || process.env.NODE_ENV === "test") {
    return generateHeuristicAttackNarrative(findings, targetUrl);
  }

  const normalizedFindings = findings.map((finding, index) => ({
    id: findingRef(finding, index),
    title: String(finding.title || "Untitled finding"),
    severity: String(finding.severity || "low").toUpperCase(),
    type: String(finding.type || ""),
    category: String(finding.category || ""),
    cve: finding.cve || null,
    description: String(finding.description || "")
  }));
  const prompt = [
    `You are a lead penetration tester generating an evidence-bound risk narrative for ${targetUrl}.`,
    "Mandatory rules:",
    "1) Only describe attack steps directly supported by provided findings.",
    "2) Do not describe privilege escalation unless privilege/auth findings exist.",
    "3) Do not describe database compromise unless SQL injection evidence exists.",
    "4) Do not describe persistent access unless authentication/session compromise evidence exists.",
    "5) Do not describe backend/internal pivoting unless network/internal exposure findings exist.",
    "6) Every narrative claim must include at least one finding ID.",
    "Output strict JSON only in this shape:",
    "{\"claims\":[{\"text\":\"...\",\"findingIds\":[\"F-1\"]}]}",
    `Findings:\n${JSON.stringify(normalizedFindings, null, 2)}`
  ].join("\n");

  try {
    const response = await callGeminiText({
      apiKey,
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      userPrompt: prompt,
      maxOutputTokens: 500,
      temperature: 0.1
    });
    const raw = String(response.text || "").trim();
    const parsed = JSON.parse(raw);
    const claims = Array.isArray(parsed?.claims) ? parsed.claims : [];
    const validIds = new Set(normalizedFindings.map((item) => item.id));
    const safeClaims = claims
      .filter((claim) => claim && typeof claim.text === "string" && Array.isArray(claim.findingIds))
      .map((claim) => ({
        text: String(claim.text || "").trim(),
        findingIds: claim.findingIds
          .map((id) => String(id || "").trim())
          .filter((id) => validIds.has(id))
      }))
      .filter((claim) => claim.text && claim.findingIds.length > 0);
    if (safeClaims.length === 0) {
      throw new Error("No evidence-linked claims returned by AI narrative");
    }
    return `${safeClaims
      .map((claim) => `${claim.text} [Finding IDs: ${claim.findingIds.join(", ")}]`)
      .join("\n\n")}\n\n${NARRATIVE_DISCLAIMER}`;
  } catch (error) {
    return generateHeuristicAttackNarrative(findings, targetUrl);
  }
}

async function generateAiExecutiveSummary(context) {
  const apiKey = process.env.GEMINI_API_KEY;
  const targetUrl = context.engagement.targetUrl;
  const findingsSummary = `${context.severity.critical} Critical, ${context.severity.high} High, ${context.severity.medium} Medium, ${context.severity.low} Low.`;
  
  if (!apiKey || process.env.ENABLE_EXEC_SUMMARY_AI === "false" || process.env.NODE_ENV === "test") {
    return `Security assessment for ${targetUrl} identified ${findingsSummary} findings. The overall posture requires attention to mitigate potential exploit vectors in production.`;
  }

  const prompt = `You are a Lead Security Auditor. Write a professional, unique, 1-paragraph Executive Summary (max 120 words) for a security scan of ${targetUrl}. 
Scan stats: ${findingsSummary} findings detected.
The summary should highlight the overall posture, key concerns, and high-level recommendation. Output only the paragraph.`;

  try {
    const response = await callGeminiText({
      apiKey,
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      userPrompt: prompt,
      maxOutputTokens: 300,
      temperature: 0.3
    });
    return response.text.trim();
  } catch (error) {
    return `Security assessment for ${targetUrl} identified ${findingsSummary} findings. The overall posture requires attention to mitigate potential exploit vectors in production.`;
  }
}

function computeEPSAndROI(findings) {
  const mappedFindings = findings.map((finding) => {
    const confidence = deriveConfidenceLevel(finding);
    let eps = 20;
    if (confidence === "CONFIRMED") {
      eps = 90;
    } else if (confidence === "STRONG_SIGNAL") {
      eps = 70;
    } else if (confidence === "WEAK_SIGNAL") {
      eps = 45;
    }
    return {
      ...finding,
      eps,
      confidence,
      manualValidationRequired: needsManualValidation(confidence),
      manualValidationNote: needsManualValidation(confidence)
        ? "Manual validation recommended before treating as confirmed vulnerability."
        : ""
    };
  });

  const summary = computeSeverityBreakdown(mappedFindings);
  const minHours = Math.max(
    4,
    summary.critical * 8 + summary.high * 4 + summary.medium * 2 + summary.low
  );
  const maxHours = Math.max(
    minHours + 4,
    summary.critical * 20 +
      summary.high * 10 +
      summary.medium * 6 +
      summary.low * 3 +
      summary.info * 2
  );
  const overallEps =
    mappedFindings.length > 0
      ? Math.round(mappedFindings.reduce((sum, finding) => sum + finding.eps, 0) / mappedFindings.length)
      : 0;

  return {
    findings: mappedFindings,
    overallEps,
    remediationEffortRange: {
      minHours,
      maxHours,
      label: `${minHours}-${maxHours} hours`
    },
    breachCostRangeInr: {
      min: 5000000,
      max: 50000000,
      label: "₹50L-₹5Cr"
    },
    estimatesDisclaimer:
      "Estimates are based on industry averages and do not account for organization-specific infrastructure, data classification, or regulatory obligations."
  };
}

function computeFixRoadmap(findings) {
  const week1 = [];
  const month1 = [];
  const quarter = [];

  for (const f of findings) {
    const sev = String(f.severity || "low").toLowerCase();
    if (sev === "critical" || sev === "high") {
      week1.push(f);
    } else if (sev === "medium") {
      month1.push(f);
    } else {
      quarter.push(f);
    }
  }

  return { week1, month1, quarter };
}

async function loadReportContext(engagementId) {
  const engagement = await Engagement.findById(engagementId).lean();
  if (!engagement) {
    const error = new Error("Engagement not found");
    error.code = "ENGAGEMENT_NOT_FOUND";
    throw error;
  }

  const [plans, jobs] = await Promise.all([
    Plan.find({ engagementId }).sort({ createdAt: -1 }).lean(),
    ExecutionJob.find({ engagementId }).sort({ createdAt: -1 }).lean()
  ]);

  const findings = deduplicateFindings(flattenFindings(jobs));
  const severity = computeSeverityBreakdown(findings);
  const execution = buildExecutionSummary(jobs);
  const compliance = generateComplianceSummary(findings);
  const securityScore = calculateSecurityScore(findings, jobs);

  // Compute intelligence layer
  const {
    findings: enrichedFindings,
    overallEps,
    remediationEffortRange,
    breachCostRangeInr,
    estimatesDisclaimer
  } = computeEPSAndROI(findings);

  const roadmap = computeFixRoadmap(enrichedFindings);
  const attackNarrative = await generateAttackNarrative(enrichedFindings, engagement.targetUrl);
  const aiExecutiveSummary = await generateAiExecutiveSummary({ engagement, severity });

  // Compute Evidence SHA-256 hash
  const rawDataForHash = JSON.stringify({
    engagementId: String(engagement._id),
    targetUrl: engagement.targetUrl,
    findingsCount: enrichedFindings.length,
    findingsKeys: enrichedFindings.map(f => `${f.title}:${f.severity}`)
  });
  const evidenceHash = crypto.createHash("sha256").update(rawDataForHash).digest("hex");

  return {
    engagement,
    plans,
    jobs,
    findings: enrichedFindings,
    severity,
    execution,
    compliance,
    securityScore,
    intelligence: {
      overallEps,
      attackNarrative,
      aiExecutiveSummary,
      roadmap,
      evidenceHash,
      remediationEffortRange,
      breachCostRangeInr,
      estimatesDisclaimer
    }
  };
}

function buildMarkdownReport(context) {
  const lines = [];
  lines.push("# VENOM Security Assessment Report");
  lines.push("");
  lines.push(`Generated At: ${new Date().toISOString()}`);
  lines.push(`Engagement: ${context.engagement.name}`);
  lines.push(`Target URL: ${context.engagement.targetUrl}`);
  lines.push(`Target Type: ${context.engagement.targetType}`);
  lines.push(`Status: ${context.engagement.status}`);
  lines.push("");
  lines.push("## Executive Summary");
  lines.push(`- Findings: ${context.findings.length}`);
  lines.push(`- Critical: ${context.severity.critical}`);
  lines.push(`- High: ${context.severity.high}`);
  lines.push(`- Medium: ${context.severity.medium}`);
  lines.push(`- Low: ${context.severity.low}`);
  lines.push(`- Success rate: ${context.execution.successRate}%`);
  lines.push(
    `- Security Score: ${context.securityScore?.score ?? 0}/100${context.securityScore?.densityLabel ? ` (${context.securityScore.densityLabel})` : ""}, Risk ${context.securityScore?.riskRating || "LOW"}, OWASP categories ${context.compliance.owaspCoverage}`
  );
  lines.push("");

  lines.push("## Findings");
  if (context.findings.length === 0) {
    lines.push("- No findings captured.");
  } else {
    context.findings.forEach((finding, index) => {
      lines.push(
        `${index + 1}. [${String(finding.severity || "info").toUpperCase()}] ${
          finding.title || "Untitled finding"
        }`
      );
      lines.push(`   - Category: ${finding.category || "n/a"}`);
      lines.push(`   - Description: ${finding.description || "n/a"}`);
      lines.push(`   - Recommendation: ${finding.recommendation || "n/a"}`);
      if (finding.exploitationPotential) {
        lines.push(`   - Exploitation Potential: ${finding.exploitationPotential}`);
      }
      if (finding.cve) {
        lines.push(`   - CVE: ${finding.cve}`);
      }
      if (Number(finding.count || 1) > 1) {
        lines.push(`   - Repeated Signals: ${finding.count}`);
      }
    });
  }

  lines.push("");
  lines.push("## OWASP Coverage");
  const owaspItems = Object.values(context.compliance.owaspBreakdown || {});
  if (owaspItems.length === 0) {
    lines.push("- No OWASP mappings available.");
  } else {
    for (const item of owaspItems) {
      lines.push(`- ${item.code}: ${item.name} (${item.findings.length} finding(s))`);
    }
  }
  lines.push("");
  lines.push("> Authorized security validation use only.");

  return lines.join("\n");
}

function toTemplateData(context, options = {}) {
  const redacted = Boolean(options.redacted);
  const managerMode = options.mode === "manager";
  const developerMode = !managerMode;

  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });
  const riskLevel = String(context.securityScore?.riskRating || "LOW").toLowerCase();
  const riskScore = Number(context.securityScore?.score || 0);
  const densityLabel = String(context.securityScore?.densityLabel || "").trim();
  const owaspItems = Object.entries(context.compliance.owaspBreakdown || {}).map(
    ([code, item]) => ({
      code,
      name: item.name,
      findingCount: Array.isArray(item.findings) ? item.findings.length : 0
    })
  );
  const latestPlan = context.plans[0] || null;
  const planPhases = Array.isArray(latestPlan?.phases)
    ? latestPlan.phases.slice(0, 4).map((phase) => ({
        name: phase?.name || "Phase",
        description: phase?.goal || "No objective provided."
      }))
    : [];

  const executionTimeline = Array.isArray(context.jobs)
    ? context.jobs.map(job => ({
        tool: job.toolId || "scan",
        type: job.type || "Automated Probe",
        status: job.status || "completed",
        durationMs: Number(job.durationMs || 100)
      }))
    : [];

  return {
    managerMode,
    developerMode,
    engagementName: context.engagement.name || "Unnamed",
    targetUrl: redacted
      ? redactTargetUrl(context.engagement.targetUrl)
      : context.engagement.targetUrl || "n/a",
    targetType: context.engagement.targetType || "website",
    authorizedBy: redacted
      ? maskEmail(context.engagement.authorization?.authorizedBy || "Authorized User")
      : context.engagement.authorization?.authorizedBy || "Authorized User",
    validFrom: formatDate(context.engagement.authorization?.validFrom),
    validUntil: formatDate(context.engagement.authorization?.validUntil),
    generatedAt,
    reportId: crypto.randomBytes(4).toString("hex").toUpperCase(),

    overallRiskSentence: densityLabel
      ? `${context.findings.length} finding(s) detected. Security score ${riskScore}/100 (${String(context.securityScore?.riskRating || "LOW").toUpperCase()}) — ${densityLabel}.`
      : `${context.findings.length} finding(s) detected. Security score ${riskScore}/100 (${String(context.securityScore?.riskRating || "LOW").toUpperCase()}).`,
    riskLevel: context.securityScore?.riskRating || "LOW",
    riskScore,
    riskBannerColor: RISK_BANNER_COLOR[riskLevel] || RISK_BANNER_COLOR.low,
    cvssScore: context.compliance.cvssOverallScore,
    owaspCount: owaspItems.length,

    totalFindings: context.findings.length,
    criticalCount: context.severity.critical,
    highCount: context.severity.high,
    mediumCount: context.severity.medium,
    successRate: context.execution.successRate,
    totalJobs: context.execution.totalJobs,
    avgDurationMs: context.execution.avgDurationMs,

    findings: context.findings.map((finding, idx) => {
      const severity = String(finding.severity || "info").toUpperCase();
      
      const what = finding.description || finding.what || "No description provided.";
      const discoveryVector =
        String(finding.discoveryVector || finding.how || "").trim() ||
        "Evidence capture failed — discovery vector was not provided by scanner output.";
      const evidenceSummary =
        finding.evidence && typeof finding.evidence === "object"
          ? `Request: ${finding.evidence?.request?.method || "GET"} ${finding.evidence?.request?.url || "unknown-url"} | Response: HTTP ${finding.evidence?.response?.statusCode || "n/a"} in ${finding.evidence?.response?.responseTimeMs || 0}ms.`
          : String(finding.evidence || finding.whatFound || "").trim();
      const how = discoveryVector;
      const whatFound =
        evidenceSummary ||
        "Evidence capture failed — scanner did not persist request/response evidence for this finding.";
      const why = finding.why || `This presents a potential vector for security compromise in ${finding.category || "the system"}.`;
      const fix = finding.recommendation || finding.remediation || finding.fix || "Remediate according to standard hardening guidelines.";

      const explicitRepro = Array.isArray(finding.reproductionSteps)
        ? finding.reproductionSteps.filter((step) => String(step || "").trim().length > 0)
        : [];
      const reproductionSteps =
        explicitRepro.length > 0
          ? explicitRepro
          : [
              `curl -i -X GET '${finding?.metadata?.targetUrl || context.engagement.targetUrl || "https://target.example"}'`,
              "Evidence capture failed — scanner did not provide reproducible request steps."
            ];

      return {
        ...finding,
        id: idx + 1,
        title: finding.title || "Untitled finding",
        severity,
        severityClass: SEVERITY_CLASS[severity] || "info",
        confidence: finding.confidence || "WEAK_SIGNAL",
        manualValidationRequired: Boolean(finding.manualValidationRequired),
        manualValidationNote: finding.manualValidationNote || "",
        tagsStr: Array.isArray(finding.tags) ? finding.tags.join(", ") : "",
        tool: finding.tool || finding._toolId || "",
        recommendation: fix,
        count: Number(finding.count || 0) > 1 ? Number(finding.count) : null,
        eps: finding.eps,
        what,
        how,
        whatFound,
        why,
        fix,
        reproductionSteps
      };
    }),
    owaspItems,
    planSummary: latestPlan?.summary || "",
    planPhases,

    // Intelligence properties
    execSummaryText: context.intelligence.aiExecutiveSummary,
    attackNarrative: context.intelligence.attackNarrative,
    roadmap: context.intelligence.roadmap,
    evidenceHash: context.intelligence.evidenceHash,
    estimatedRemediationEffort:
      context.intelligence.remediationEffortRange?.label || "15-40 hours",
    estimatedBreachCostRange:
      context.intelligence.breachCostRangeInr?.label || "₹50L-₹5Cr",
    estimatesDisclaimer:
      context.intelligence.estimatesDisclaimer ||
      "Estimates are based on industry averages and do not account for organization-specific infrastructure, data classification, or regulatory obligations.",
    executionTimeline
  };
}

function renderHtmlFromTemplate(templateData) {
  const templateHtml = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const template = handlebars.compile(templateHtml);
  return template(templateData);
}

async function renderPdfFromTemplate(templateData) {
  const html = renderHtmlFromTemplate(templateData);

  const PDF_TIMEOUT_MS = 45000;
  const pdfPromise = (async () => {
    let browser;
    try {
      let chromiumPath = process.env.CHROMIUM_PATH || "";
      let launchArgs = [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process"
      ];
      let headlessMode = chromium.headless ?? true;
      let sparticuzPathError = null;

      const localPath = resolveLocalChromiumPath();
      if (!chromiumPath) {
        try {
          chromiumPath = await chromium.executablePath();
        } catch (error) {
          sparticuzPathError = error;
        }
      }

      if (process.platform === "win32" && localPath) {
        chromiumPath = localPath;
        launchArgs = ["--disable-dev-shm-usage", "--disable-gpu"];
        headlessMode = true;
      } else if (!chromiumPath || !fs.existsSync(chromiumPath)) {
        if (localPath) {
          chromiumPath = localPath;
          launchArgs = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
          headlessMode = true;
        }
      }

      if (!chromiumPath || !fs.existsSync(chromiumPath)) {
        const extra =
          sparticuzPathError && sparticuzPathError instanceof Error
            ? ` (${sparticuzPathError.message})`
            : "";
        throw new Error(
          `No Chromium executable found. Set CHROMIUM_PATH for local PDF generation${extra}.`
        );
      }

      browser = await puppeteer.launch({
        args: launchArgs,
        defaultViewport: chromium.defaultViewport,
        executablePath: chromiumPath,
        headless: headlessMode
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      return await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" }
      });
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  })();

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error("PDF generation timed out after 45s")),
      PDF_TIMEOUT_MS
    );
  });

  return Promise.race([pdfPromise, timeoutPromise]);
}

async function generatePdfReport(engagementId, options = {}) {
  const context = await loadReportContext(engagementId);
  const templateData = toTemplateData(context, { redacted: false, ...options });
  return await renderPdfFromTemplate(templateData);
}

async function generateMarkdownReport(engagementId) {
  const context = await loadReportContext(engagementId);
  return buildMarkdownReport(context);
}

async function generateHtmlReport(engagementId, options = {}) {
  const context = await loadReportContext(engagementId);
  const templateData = toTemplateData(context, {
    redacted: options.redacted !== false,
    ...options
  });
  return renderHtmlFromTemplate(templateData);
}

function assertSmtpConfigured() {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const error = new Error(`SMTP is not configured. Missing: ${missing.join(", ")}`);
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeSmtpError(error) {
  const message = String(error?.message || "SMTP operation failed");
  const normalized = message.toLowerCase();
  const code = String(error?.code || "").toUpperCase();

  if (
    code === "EAUTH" ||
    normalized.includes("invalid login") ||
    normalized.includes("authentication")
  ) {
    const authError = new Error("SMTP authentication failed. Check SMTP_USER/SMTP_PASS.");
    authError.code = "SMTP_AUTH_FAILED";
    return authError;
  }

  if (
    code === "ETIMEDOUT" ||
    code === "ECONNECTION" ||
    code === "ESOCKET" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    normalized.includes("timed out") ||
    normalized.includes("connection") ||
    normalized.includes("greeting never received")
  ) {
    const connectionError = new Error(
      "SMTP connection failed or timed out. Check SMTP_HOST/SMTP_PORT and provider firewall rules."
    );
    connectionError.code = "SMTP_CONNECT_FAILED";
    return connectionError;
  }

  const fallbackError = new Error(`SMTP send failed: ${message}`);
  fallbackError.code = "SMTP_SEND_FAILED";
  return fallbackError;
}

async function emailReport(engagementId, recipientEmail) {
  assertSmtpConfigured();
  if (!recipientEmail || typeof recipientEmail !== "string") {
    const error = new Error("recipientEmail is required");
    error.code = "INVALID_EMAIL";
    throw error;
  }

  const context = await loadReportContext(engagementId);
  const templateData = toTemplateData(context);
  const pdfBuffer = await renderPdfFromTemplate(templateData);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_PORT || "587") === "465",
    connectionTimeout: toPositiveInt(process.env.SMTP_CONNECTION_TIMEOUT_MS, 7000),
    greetingTimeout: toPositiveInt(process.env.SMTP_GREETING_TIMEOUT_MS, 7000),
    socketTimeout: toPositiveInt(process.env.SMTP_SOCKET_TIMEOUT_MS, 10000),
    dnsTimeout: toPositiveInt(process.env.SMTP_DNS_TIMEOUT_MS, 5000),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const safeName = sanitizeFileName(context.engagement.name);
  const fileName = `venom-report-${safeName}-${Date.now()}.pdf`;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: recipientEmail,
      subject: `[VENOM] Security Report - ${context.engagement.name}`,
      text: `Attached is the VENOM security report for ${context.engagement.targetUrl}.`,
      attachments: [
        {
          filename: fileName,
          content: pdfBuffer,
          contentType: "application/pdf"
        }
      ]
    });
  } catch (error) {
    throw normalizeSmtpError(error);
  }

  return {
    sent: true,
    to: recipientEmail,
    fileName
  };
}

module.exports = {
  flattenFindings,
  computeSeverityBreakdown,
  loadReportContext,
  generatePdfReport,
  generateHtmlReport,
  generateMarkdownReport,
  emailReport
};
