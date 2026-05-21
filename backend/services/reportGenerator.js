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
  const completedJobs = jobs.filter((job) =>
    ["completed", "success"].includes(String(job.status || "").toLowerCase())
  );
  const failedJobs = jobs.filter((job) =>
    ["failed", "blocked", "timeout", "killed"].includes(
      String(job.status || "").toLowerCase()
    )
  );
  const terminalJobs = completedJobs.length + failedJobs.length;
  const successRate =
    terminalJobs > 0 ? Math.round((completedJobs.length / terminalJobs) * 100) : 0;
  const avgDurationMs =
    completedJobs.length > 0
      ? Math.round(
          completedJobs.reduce((sum, job) => sum + Number(job.durationMs || 0), 0) /
            completedJobs.length
        )
      : 0;

  return {
    totalJobs,
    completedJobs: completedJobs.length,
    failedJobs: failedJobs.length,
    successRate,
    avgDurationMs
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
  const deductions = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };
  let score = 100;
  const bySeverity = computeSeverityBreakdown(findings);
  let severityDeductionTotal = 0;

  for (const [severity, deduction] of Object.entries(deductions)) {
    const total = (bySeverity[severity] || 0) * deduction;
    score -= total;
    severityDeductionTotal += total;
  }

  const failedJobs = jobs.filter((job) => ["failed", "error"].includes(normalizeJobStatus(job.status)));
  const timeoutJobs = jobs.filter((job) => normalizeJobStatus(job.status) === "timeout");
  const blockedJobs = jobs.filter((job) => normalizeJobStatus(job.status) === "blocked");
  const toolMissingJobs = jobs.filter((job) => normalizeJobStatus(job.status) === "tool_not_installed");
  let probeDeductionTotal = 0;

  const failedWithoutToolMissing = failedJobs.filter(
    (job) => job.output?.errorCode !== "TOOL_NOT_INSTALLED"
  ).length;
  score -= failedWithoutToolMissing * 5;
  score -= timeoutJobs.length * 2;
  probeDeductionTotal += failedWithoutToolMissing * 5;
  probeDeductionTotal += timeoutJobs.length * 2;

  const defenseSignals = [...blockedJobs];
  for (const job of jobs) {
    if (Array.isArray(job?.output?.defenseSignals) && job.output.defenseSignals.length > 0) {
      defenseSignals.push(...job.output.defenseSignals.map(() => job));
    }
  }
  score += defenseSignals.length * 3;

  const cleanCategories = new Set();
  for (const job of jobs) {
    if (normalizeJobStatus(job.status) === "success" && collectJobFindings(job).length === 0) {
      cleanCategories.add(job.toolId || "scan");
    }
  }
  score += Math.min(10, cleanCategories.size * 2);

  const reliabilityJobs = jobs.filter(
    (job) =>
      ["success", "failed", "error", "timeout"].includes(normalizeJobStatus(job.status)) &&
      !toolMissingJobs.some((missingJob) => String(missingJob._id) === String(job._id))
  );
  const failedOrTimedOut = reliabilityJobs.filter((job) =>
    ["failed", "error", "timeout"].includes(normalizeJobStatus(job.status))
  );
  const unreliable =
    reliabilityJobs.length > 0 && failedOrTimedOut.length > reliabilityJobs.length / 2;
  const rawDeduction = severityDeductionTotal + probeDeductionTotal;
  const unclampedScore = Math.round(score);
  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const densityLabel = unclampedScore < 0 ? deriveDensityLabel(rawDeduction) : "";

  return {
    score: finalScore,
    maxScore: 100,
    rawDeduction,
    densityLabel,
    riskRating: riskFromFindings(findings),
    reliable: !unreliable,
    unreliableReason: unreliable
      ? "Score could not be accurately calculated because too many scan probes failed. Address probe failures to get an accurate score."
      : ""
  };
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

function generateHeuristicAttackNarrative(findings, targetUrl) {
  if (!findings || findings.length === 0) {
    return "No significant security vulnerabilities were identified. The application posture is currently clean, presenting a minimal attack surface.";
  }

  const criticals = findings.filter(f => String(f.severity).toLowerCase() === "critical");
  const highs = findings.filter(f => String(f.severity).toLowerCase() === "high");
  const mediums = findings.filter(f => String(f.severity).toLowerCase() === "medium");

  const narrativeParts = [];

  if (criticals.length > 0) {
    narrativeParts.push(`An attacker targeting ${targetUrl} would likely begin by exploiting the critical vulnerabilities discovered, such as ${criticals[0].title}. By targeting these high-impact endpoints or flaws, the threat actor could gain unauthorized administrative access, execute remote commands, or bypass core authentication systems.`);
  }

  if (highs.length > 0) {
    const context = criticals.length > 0 ? "Following initial access, the" : "An attacker targeting the application would leverage the";
    narrativeParts.push(`${context} high-severity issues (e.g., ${highs[0].title}) to escalate privileges, extract sensitive database schemas, or pivot into backend systems. This allows the attacker to maintain persistent control over the infrastructure.`);
  }

  if (mediums.length > 0) {
    const context = (criticals.length > 0 || highs.length > 0) ? "To reinforce control or exfiltrate credentials, the attacker could exploit" : "The attacker would exploit";
    narrativeParts.push(`${context} medium-severity gaps like ${mediums[0].title} to perform lateral movement, intercept communication, or gain internal infrastructure insights.`);
  }

  if (narrativeParts.length === 0) {
    narrativeParts.push("The scan identified low-severity and informational hygiene findings. While these do not present immediate compromise vectors, they weaken defense-in-depth and should be hardened to prevent information leakage or reconnaissance scanning.");
  }

  return narrativeParts.join(" ");
}

async function generateAttackNarrative(findings, targetUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || process.env.ENABLE_ATTACK_NARRATIVE_AI === "false" || process.env.NODE_ENV === "test") {
    return generateHeuristicAttackNarrative(findings, targetUrl);
  }

  const prompt = `You are a Lead Penetration Tester. Review the following security findings for target ${targetUrl}:
${JSON.stringify(findings.map(f => ({ title: f.title, severity: f.severity, category: f.category, description: f.description })), null, 2)}

Provide a concise, plain English narrative (2-3 paragraphs) of how an attacker would chain these findings to compromise the target application. Be realistic, highlight the business risk, and keep it readable for non-technical leadership. Do not write generic text. Output only the paragraphs.`;

  try {
    const response = await callGeminiText({
      apiKey,
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      userPrompt: prompt,
      maxOutputTokens: 500,
      temperature: 0.3
    });
    return response.text.trim();
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
  const mappedFindings = findings.map(finding => {
    const severity = String(finding.severity || "low").toLowerCase();
    
    let eps = 10;
    if (severity === "critical") eps = 85;
    else if (severity === "high") eps = 65;
    else if (severity === "medium") eps = 40;
    else if (severity === "low") eps = 20;

    if (finding.cve) {
      eps += 15;
    }
    if (finding.exploitationPotential && String(finding.exploitationPotential).toLowerCase().includes("easy")) {
      eps += 10;
    }
    eps = Math.min(eps, 99);

    return {
      ...finding,
      eps
    };
  });

  const overallEps = findings.length > 0 
    ? Math.round(mappedFindings.reduce((sum, f) => sum + f.eps, 0) / findings.length)
    : 0;

  return {
    findings: mappedFindings,
    overallEps
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
    overallEps
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
      evidenceHash
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
