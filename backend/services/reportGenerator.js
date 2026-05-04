const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const Plan = require("../models/Plan");
const { generateComplianceSummary } = require("./complianceMapper");

function flattenFindings(jobs = []) {
  return jobs.flatMap((job) => {
    if (Array.isArray(job.findings) && job.findings.length > 0) {
      return job.findings;
    }
    if (Array.isArray(job.output?.findings)) {
      return job.output.findings;
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

function sanitizeFileName(value) {
  return String(value || "engagement")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "engagement";
}

function buildExecutionSummary(jobs = []) {
  const totalJobs = jobs.length;
  const successfulJobs = jobs.filter((job) => job.status === "success").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const blockedJobs = jobs.filter((job) => job.status === "blocked").length;
  const timeoutJobs = jobs.filter((job) => job.status === "timeout").length;
  const terminalJobs = successfulJobs + failedJobs + blockedJobs + timeoutJobs;
  const successRate =
    terminalJobs > 0
      ? Number((successfulJobs / terminalJobs).toFixed(4))
      : 0;

  return {
    totalJobs,
    successfulJobs,
    failedJobs,
    blockedJobs,
    timeoutJobs,
    successRate
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

  const findings = flattenFindings(jobs);
  const severity = computeSeverityBreakdown(findings);
  const executionSummary = buildExecutionSummary(jobs);
  const compliance = generateComplianceSummary(findings);

  return {
    engagement,
    plans,
    jobs,
    findings,
    severity,
    executionSummary,
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
  lines.push(
    `Authorization: ${context.engagement.authorization?.authorizedBy || "n/a"}`
  );
  lines.push(
    `Valid Window: ${formatDate(context.engagement.authorization?.validFrom)} -> ${formatDate(context.engagement.authorization?.validUntil)}`
  );
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`- Total findings: ${context.findings.length}`);
  lines.push(`- Critical: ${context.severity.critical}`);
  lines.push(`- High: ${context.severity.high}`);
  lines.push(`- Medium: ${context.severity.medium}`);
  lines.push(`- Low: ${context.severity.low}`);
  lines.push(`- Info: ${context.severity.info}`);
  lines.push(
    `- Jobs: ${context.executionSummary.totalJobs} (success rate ${(context.executionSummary.successRate * 100).toFixed(1)}%)`
  );
  lines.push(
    `- Compliance: CVSS ${context.compliance.cvssOverallScore} (${context.compliance.cvssSeverity}), OWASP categories ${context.compliance.owaspCoverage}`
  );
  lines.push("");
  lines.push("## Findings");
  lines.push("");
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
    });
  }
  lines.push("");
  lines.push("## Plan Summary");
  lines.push("");
  if (context.plans.length === 0) {
    lines.push("- No plans generated.");
  } else {
    context.plans.forEach((plan, idx) => {
      lines.push(`${idx + 1}. ${plan.summary || "No summary"} (${plan.promptVersion})`);
    });
  }
  lines.push("");
  lines.push("## Compliance Breakdown");
  lines.push("");
  lines.push(
    `- CVSS Overall: ${context.compliance.cvssOverallScore} (${context.compliance.cvssSeverity})`
  );
  lines.push(`- OWASP Coverage: ${context.compliance.owaspCoverage}`);
  Object.values(context.compliance.owaspBreakdown || {}).forEach((entry) => {
    lines.push(`  - ${entry.code}: ${entry.name} (${entry.findings.length} finding(s))`);
  });
  lines.push("");
  lines.push("> This report is generated for authorized security validation use only.");
  return lines.join("\n");
}

function buildPdfReportBuffer(context) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(19).text("VENOM Security Assessment Report", { underline: true });
    doc.moveDown(0.8);
    doc.fontSize(10);
    doc.text(`Generated: ${new Date().toISOString()}`);
    doc.text(`Engagement: ${context.engagement.name}`);
    doc.text(`Target: ${context.engagement.targetUrl}`);
    doc.text(`Target Type: ${context.engagement.targetType}`);
    doc.text(
      `Authorization: ${context.engagement.authorization?.authorizedBy || "n/a"}`
    );
    doc.moveDown(0.8);

    doc.fontSize(13).text("Executive Summary");
    doc.fontSize(10);
    doc.text(`Total Findings: ${context.findings.length}`);
    doc.text(
      `Severity: C=${context.severity.critical} H=${context.severity.high} M=${context.severity.medium} L=${context.severity.low} I=${context.severity.info}`
    );
    doc.text(
      `Jobs: ${context.executionSummary.totalJobs} | Success Rate: ${(context.executionSummary.successRate * 100).toFixed(1)}%`
    );
    doc.text(
      `Compliance: CVSS ${context.compliance.cvssOverallScore} (${context.compliance.cvssSeverity}), OWASP ${context.compliance.owaspCoverage}`
    );
    doc.moveDown(0.8);

    doc.fontSize(13).text("Top Findings");
    doc.fontSize(10);
    if (context.findings.length === 0) {
      doc.text("No findings captured.");
    } else {
      context.findings.slice(0, 25).forEach((finding, index) => {
        doc.text(
          `${index + 1}. [${String(finding.severity || "info").toUpperCase()}] ${
            finding.title || "Untitled finding"
          }`
        );
        if (finding.description) {
          doc.text(`   ${finding.description}`);
        }
        if (finding.recommendation) {
          doc.text(`   Recommendation: ${finding.recommendation}`);
        }
        if (finding.cve) {
          doc.text(`   CVE: ${finding.cve}`);
        }
      });
    }

    doc.moveDown(0.8);
    doc.fontSize(13).text("OWASP Top 10 Coverage");
    doc.fontSize(10);
    const owaspEntries = Object.values(context.compliance.owaspBreakdown || {});
    if (owaspEntries.length === 0) {
      doc.text("No OWASP category mapping available from current findings.");
    } else {
      owaspEntries.forEach((entry) => {
        doc.text(`${entry.code} - ${entry.name}: ${entry.findings.length} finding(s)`);
      });
    }

    doc.moveDown(1);
    doc.fontSize(8);
    doc.text(
      "Generated by VENOM autonomous reporting pipeline. Authorized distribution only.",
      {
        align: "left"
      }
    );

    doc.end();
  });
}

function assertSmtpConfigured() {
  const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    const error = new Error(`SMTP is not configured. Missing: ${missing.join(", ")}`);
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }
}

async function generatePdfReport(engagementId) {
  const context = await loadReportContext(engagementId);
  return buildPdfReportBuffer(context);
}

async function generateMarkdownReport(engagementId) {
  const context = await loadReportContext(engagementId);
  return buildMarkdownReport(context);
}

async function emailReport(engagementId, recipientEmail) {
  assertSmtpConfigured();
  if (!recipientEmail || typeof recipientEmail !== "string") {
    const error = new Error("recipientEmail is required");
    error.code = "INVALID_EMAIL";
    throw error;
  }

  const context = await loadReportContext(engagementId);
  const pdfBuffer = await buildPdfReportBuffer(context);

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
