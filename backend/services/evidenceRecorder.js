const Evidence = require("../models/Evidence");

const MAX_RAW_OUTPUT_CHARS = 100000;
const MAX_FINDINGS_PER_JOB = 50;

function safeStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function truncate(text, maxChars) {
  if (!text || typeof text !== "string") {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n...[truncated ${text.length - maxChars} chars]`;
}

function normalizeFinding(finding, fallbackId) {
  if (!finding || typeof finding !== "object") {
    return {
      id: fallbackId,
      severity: "low",
      category: "unknown",
      title: "Unknown finding",
      description: "",
      recommendation: ""
    };
  }

  return {
    id: finding.id || fallbackId,
    severity: finding.severity || "low",
    category: finding.category || "unknown",
    title: finding.title || "Untitled finding",
    description: finding.description || "",
    recommendation: finding.recommendation || "",
    exploitationPotential: finding.exploitationPotential || "",
    cve: finding.cve || null,
    source: finding.source || "",
    metadata: finding.metadata || {}
  };
}

async function recordExecutionEvidence(job, collectedBy = "venom-system") {
  if (!job?.engagementId || !job?._id) {
    return { created: 0 };
  }

  const rawEvidenceContent = truncate(
    safeStringify({
      jobId: job._id,
      engagementId: job.engagementId,
      toolId: job.toolId,
      status: job.status,
      errorMessage: job.errorMessage || "",
      output: job.output || {},
      rawOutput: job.rawOutput || ""
    }),
    MAX_RAW_OUTPUT_CHARS
  );

  const documents = [
    {
      engagementId: job.engagementId,
      jobId: job._id,
      evidenceType: "raw_output",
      content: rawEvidenceContent,
      collectedBy,
      toolId: job.toolId,
      metadata: {
        status: job.status,
        targetUrl: job.targetUrl,
        durationMs: job.durationMs || 0
      }
    }
  ];

  const findings = Array.isArray(job.findings)
    ? job.findings.slice(0, MAX_FINDINGS_PER_JOB)
    : [];
  findings.forEach((finding, index) => {
    documents.push({
      engagementId: job.engagementId,
      jobId: job._id,
      evidenceType: "finding",
      content: safeStringify(normalizeFinding(finding, `${job._id}-${index + 1}`)),
      collectedBy,
      toolId: job.toolId,
      metadata: {
        findingIndex: index + 1,
        severity: finding?.severity || "low"
      }
    });
  });

  const created = [];
  for (const document of documents) {
    // Sequential writes preserve deterministic chain ordering and avoid
    // chainIndex collisions when multiple evidence entries are recorded together.
    // eslint-disable-next-line no-await-in-loop
    const saved = await Evidence.create(document);
    created.push(saved);
  }

  return { created: created.length };
}

module.exports = {
  recordExecutionEvidence
};
