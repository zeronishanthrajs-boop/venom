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

  return {
    engagement,
    plans,
    jobs,
    findings,
    severity,
    execution,
    compliance
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
    `- Compliance: CVSS ${context.compliance.cvssOverallScore} (${context.compliance.cvssSeverity}), OWASP categories ${context.compliance.owaspCoverage}`
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

function toTemplateData(context) {
  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });
  const riskLevel = String(context.compliance.cvssSeverity || "LOW").toLowerCase();
  const riskScore = Math.round(Number(context.compliance.cvssOverallScore || 0) * 10);
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

  return {
    engagementName: context.engagement.name || "Unnamed",
    targetUrl: context.engagement.targetUrl || "n/a",
    targetType: context.engagement.targetType || "website",
    authorizedBy: context.engagement.authorization?.authorizedBy || "Authorized User",
    validFrom: formatDate(context.engagement.authorization?.validFrom),
    validUntil: formatDate(context.engagement.authorization?.validUntil),
    generatedAt,
    reportId: crypto.randomBytes(4).toString("hex").toUpperCase(),

    overallRiskSentence: `${context.findings.length} finding(s) detected. CVSS ${context.compliance.cvssOverallScore} (${context.compliance.cvssSeverity}).`,
    riskLevel: context.compliance.cvssSeverity || "LOW",
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

    findings: context.findings.map((finding) => ({
      ...finding,
      severity: String(finding.severity || "info").toUpperCase(),
      severityClass:
        SEVERITY_CLASS[String(finding.severity || "INFO").toUpperCase()] || "info",
      tagsStr: Array.isArray(finding.tags) ? finding.tags.join(", ") : "",
      tool: finding.tool || finding._toolId || "",
      recommendation: finding.recommendation || finding.remediation || "",
      count: Number(finding.count || 0) > 1 ? Number(finding.count) : null
    })),
    owaspItems,
    planSummary: latestPlan?.summary || "",
    planPhases
  };
}

async function renderPdfFromTemplate(templateData) {
  const templateHtml = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  const template = handlebars.compile(templateHtml);
  const html = template(templateData);

  const PDF_TIMEOUT_MS = 45000;
  const pdfPromise = (async () => {
    let browser;
    try {
      const chromiumPath =
        process.env.CHROMIUM_PATH || (await chromium.executablePath());
      browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process"
        ],
        defaultViewport: chromium.defaultViewport,
        executablePath: chromiumPath,
        headless: chromium.headless ?? true
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

async function generatePdfReport(engagementId) {
  const context = await loadReportContext(engagementId);
  const templateData = toTemplateData(context);
  return await renderPdfFromTemplate(templateData);
}

async function generateMarkdownReport(engagementId) {
  const context = await loadReportContext(engagementId);
  return buildMarkdownReport(context);
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
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const safeName = sanitizeFileName(context.engagement.name);
  const fileName = `venom-report-${safeName}-${Date.now()}.pdf`;

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

  return {
    sent: true,
    to: recipientEmail,
    fileName
  };
}

module.exports = {
  flattenFindings,
  computeSeverityBreakdown,
  generatePdfReport,
  generateMarkdownReport,
  emailReport
};
