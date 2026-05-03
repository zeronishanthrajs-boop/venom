import type { EngagementReport } from "./api";

export type ReportViewMode = "summary" | "detailed";
export type ReportFormat = "markdown" | "pdf";

type DownloadOptions = {
  format: ReportFormat;
  viewMode: ReportViewMode;
};

function formatDate(value?: string) {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function sanitizeFileName(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "venom-engagement";
}

function getFileBaseName(report: EngagementReport) {
  const safeName = sanitizeFileName(report.engagement?.name || "engagement");
  return `${safeName}-${report.engagement?._id || "report"}`;
}

function buildExecutiveSection(report: EngagementReport, lines: string[]) {
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`- Plans generated: ${report.summary.totalPlans}`);
  lines.push(`- Jobs run: ${report.summary.totalExecutionJobs}`);
  lines.push(`- Successful jobs: ${report.summary.successfulJobs}`);
  lines.push(`- Failed jobs: ${report.summary.failedJobs}`);
  lines.push(`- Blocked jobs: ${report.summary.blockedJobs}`);
  lines.push(`- Timeout jobs: ${report.summary.timeoutJobs}`);
  lines.push("");
}

function buildPatternSection(report: EngagementReport, lines: string[]) {
  lines.push("## Pattern Match Scores");
  lines.push("");
  if (!report.patternMatches.length) {
    lines.push("- No pattern scores available.");
    lines.push("");
    return;
  }

  report.patternMatches.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.patternName} | score=${item.applicabilityScore} | confidence=${item.confidence} | recent=${item.recentSuccessRate}`
    );
  });
  lines.push("");
}

function buildTechnicalSection(report: EngagementReport, lines: string[]) {
  lines.push("## Technical Report");
  lines.push("");

  if (!report.plans.length) {
    lines.push("No plans available.");
    lines.push("");
  } else {
    lines.push("### Plans");
    lines.push("");
    report.plans.forEach((plan, index) => {
      lines.push(`#### Plan ${index + 1}`);
      lines.push(`- ID: ${plan._id}`);
      lines.push(`- Prompt Version: ${plan.promptVersion}`);
      lines.push(`- Planner Source: ${plan.plannerSource}`);
      lines.push(`- Model: ${plan.model}`);
      lines.push(`- Created At: ${formatDate(plan.createdAt)}`);
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(plan, null, 2));
      lines.push("```");
      lines.push("");
    });
  }

  if (!report.executionJobs.length) {
    lines.push("No execution jobs available.");
    lines.push("");
    return;
  }

  lines.push("### Execution Jobs");
  lines.push("");
  report.executionJobs.forEach((job, index) => {
    lines.push(`#### Job ${index + 1}`);
    lines.push(`- ID: ${job._id}`);
    lines.push(`- Tool: ${job.toolId}`);
    lines.push(`- Status: ${job.status}`);
    lines.push(`- Target: ${job.targetUrl}`);
    lines.push(`- Started: ${formatDate(job.startedAt)}`);
    lines.push(`- Finished: ${formatDate(job.finishedAt)}`);
    lines.push(`- Duration (ms): ${job.durationMs ?? "N/A"}`);
    if (job.errorMessage) {
      lines.push(`- Error: ${job.errorMessage}`);
    }
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(job, null, 2));
    lines.push("```");
    lines.push("");
  });
}

export function buildEngagementMarkdownReport(
  report: EngagementReport,
  viewMode: ReportViewMode
) {
  const lines: string[] = [];
  lines.push("# VENOM Engagement Report");
  lines.push("");
  lines.push(`Generated At: ${formatDate(report.generatedAt)}`);
  lines.push(`Engagement ID: ${report.engagement._id}`);
  lines.push(`Name: ${report.engagement.name}`);
  lines.push(`Target URL: ${report.engagement.targetUrl}`);
  lines.push(`Target Type: ${report.engagement.targetType}`);
  lines.push(`Status: ${report.engagement.status}`);
  lines.push(`Created At: ${formatDate(report.engagement.createdAt)}`);
  lines.push("");

  buildExecutiveSection(report, lines);
  buildPatternSection(report, lines);

  if (viewMode === "detailed") {
    buildTechnicalSection(report, lines);
  } else {
    lines.push("## Latest Artifacts");
    lines.push("");
    lines.push(
      `- Latest plan: ${report.latestPlan ? report.latestPlan.summary : "None"}`
    );
    lines.push(
      `- Latest execution: ${
        report.latestExecutionJob
          ? `${report.latestExecutionJob.toolId} -> ${report.latestExecutionJob.status}`
          : "None"
      }`
    );
    lines.push("");
  }

  return lines.join("\n");
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadMarkdown(markdown: string, fileName: string) {
  const blob = new Blob([markdown], {
    type: "text/markdown;charset=utf-8"
  });
  triggerBlobDownload(blob, fileName);
}

async function downloadPdfFromMarkdown(markdown: string, fileName: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4"
  });

  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = doc.internal.pageSize.getHeight();
  const lineHeight = 14;
  let cursorY = margin;

  doc.setFont("courier", "normal");
  doc.setFontSize(9);

  const wrapped = doc.splitTextToSize(markdown, pageWidth) as string[];
  wrapped.forEach((line) => {
    if (cursorY > pageHeight - margin) {
      doc.addPage();
      cursorY = margin;
    }
    doc.text(line, margin, cursorY);
    cursorY += lineHeight;
  });

  doc.save(fileName);
}

export async function downloadEngagementReport(
  report: EngagementReport,
  options: DownloadOptions
) {
  const markdown = buildEngagementMarkdownReport(report, options.viewMode);
  const fileBase = getFileBaseName(report);

  if (options.format === "pdf") {
    await downloadPdfFromMarkdown(markdown, `${fileBase}.pdf`);
    return;
  }

  downloadMarkdown(markdown, `${fileBase}.md`);
}
