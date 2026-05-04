const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const { executeEngagementTool } = require("./executionService");
const { getTool } = require("../tooling/toolRegistry");
const { resolvePromptContent } = require("./promptCatalog");

const SAFE_CHAIN_TOOL_IDS = [
  "http_headers_probe",
  "tls_metadata_probe",
  "dns_lookup_probe",
  "zap_baseline_passive",
  "nmap_tcp_scan",
  "nuclei_scan",
  "nikto_scan",
  "sqlmap_detect"
];

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.httpStatus = statusCode;
  return error;
}

function hasSignal(findings, regex) {
  return findings.some((finding) =>
    regex.test(
      `${finding.title || ""} ${finding.description || ""} ${finding.category || ""}`
    )
  );
}

function buildHeuristicChainSteps(engagement, findings) {
  const baseByTargetType = {
    website: [
      "http_headers_probe",
      "dns_lookup_probe",
      "tls_metadata_probe",
      "nmap_tcp_scan",
      "nikto_scan",
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

  const selected =
    baseByTargetType[engagement.targetType] || baseByTargetType.website;
  const steps = [...selected];

  if (hasSignal(findings, /\bsql\b|\binjection\b|\bdb\b/i) && !steps.includes("sqlmap_detect")) {
    steps.push("sqlmap_detect");
  }

  if (
    hasSignal(findings, /\bheader\b|\bcsp\b|\bhsts\b|\btls\b|\bssl\b/i) &&
    !steps.includes("zap_baseline_passive")
  ) {
    steps.push("zap_baseline_passive");
  }

  return steps.map((toolId, index) => ({
    step: index + 1,
    toolId,
    name: `Step ${index + 1}: ${toolId}`,
    rationale: "Heuristic chain sequencing for authorized, read-only assessment.",
    continueOnFailure: false
  }));
}

function sanitizeChainSteps(rawSteps, engagement) {
  const whitelist = engagement.constraints?.toolWhitelist || [];
  const allowByWhitelist = (toolId) =>
    whitelist.length === 0 || whitelist.includes(toolId);

  const seen = new Set();
  const sanitized = [];
  for (const rawStep of rawSteps) {
    const toolId = String(rawStep?.toolId || "").trim();
    if (!toolId) {
      continue;
    }
    if (!SAFE_CHAIN_TOOL_IDS.includes(toolId)) {
      continue;
    }
    const tool = getTool(toolId);
    if (!tool) {
      continue;
    }
    if (!allowByWhitelist(toolId)) {
      continue;
    }
    if (engagement.constraints?.noDestructiveOps && tool.destructive) {
      continue;
    }
    if (seen.has(toolId)) {
      continue;
    }

    seen.add(toolId);
    sanitized.push({
      step: sanitized.length + 1,
      toolId,
      name:
        typeof rawStep?.name === "string" && rawStep.name.trim()
          ? rawStep.name.trim()
          : tool.name,
      rationale:
        typeof rawStep?.rationale === "string" && rawStep.rationale.trim()
          ? rawStep.rationale.trim()
          : "Chain step selected for sequential verification.",
      continueOnFailure: Boolean(rawStep?.continueOnFailure)
    });
  }

  return sanitized.slice(0, 10);
}

function flattenHistoricalFindings(jobs) {
  return jobs.flatMap((job) =>
    Array.isArray(job.findings) ? job.findings : Array.isArray(job.output?.findings) ? job.output.findings : []
  );
}

async function tryClaudeChainPlan(engagement, findings) {
  const apiKey = process.env.CLAUDE_API_KEY;
  const claudeEnabled = process.env.CLAUDE_CHAIN_ENABLED !== "false";
  if (!apiKey || !claudeEnabled) {
    return null;
  }

  const model = process.env.CLAUDE_CHAIN_MODEL || process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest";
  const scopeSnapshot = {
    targetUrl: engagement.targetUrl,
    targetType: engagement.targetType,
    scope: engagement.scope,
    constraints: engagement.constraints
  };

  const resolvedPrompt = await resolvePromptContent("chain");
  const instructions = `${resolvedPrompt.content || ""}

Return only JSON array.
Only include these tool IDs:
${SAFE_CHAIN_TOOL_IDS.join(", ")}
Output shape:
[{"toolId":"http_headers_probe","name":"...", "rationale":"...", "continueOnFailure":false}]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      temperature: 0.1,
      system: instructions,
      messages: [
        {
          role: "user",
          content: `Generate the best next-step chain for this engagement.\n\n${JSON.stringify(
            {
              scopeSnapshot,
              findings: findings.slice(0, 20)
            },
            null,
            2
          )}`
        }
      ]
    })
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const text = Array.isArray(payload?.content)
    ? payload.content.find((item) => item?.type === "text")?.text || ""
    : "";
  const cleaned = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  const jsonCandidate =
    firstBracket >= 0 && lastBracket > firstBracket
      ? cleaned.slice(firstBracket, lastBracket + 1)
      : cleaned;

  try {
    const parsed = JSON.parse(jsonCandidate);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function runExploitationChain({
  engagementId,
  createdBy = "unknown"
}) {
  const engagement = await Engagement.findById(engagementId).lean();
  if (!engagement) {
    throw createHttpError(404, "Engagement not found");
  }

  if (
    engagement.authorization?.validUntil &&
    new Date(engagement.authorization.validUntil) < new Date()
  ) {
    throw createHttpError(403, "Cannot run chain for expired authorization");
  }

  const previousJobs = await ExecutionJob.find({ engagementId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  const findings = flattenHistoricalFindings(previousJobs);

  const claudeSteps = await tryClaudeChainPlan(engagement, findings);
  const source = Array.isArray(claudeSteps) ? "claude" : "heuristic";
  const rawSteps =
    Array.isArray(claudeSteps) && claudeSteps.length > 0
      ? claudeSteps
      : buildHeuristicChainSteps(engagement, findings);

  const steps = sanitizeChainSteps(rawSteps, engagement);
  if (steps.length === 0) {
    return {
      engagementId,
      source,
      message:
        "No chain steps were eligible within current scope/constraints. Update tool whitelist or scope and retry.",
      stepsPlanned: 0,
      stepsExecuted: 0,
      chainResults: []
    };
  }

  const chainResults = [];
  let haltedAt = null;

  for (const step of steps) {
    const result = await executeEngagementTool({
      engagementId: String(engagement._id),
      toolId: step.toolId,
      requestedTargetUrl: engagement.targetUrl,
      userId: createdBy
    });

    chainResults.push({
      step: step.step,
      toolId: step.toolId,
      name: step.name,
      rationale: step.rationale,
      status: result.job.status,
      findings: Array.isArray(result.job.findings) ? result.job.findings.length : 0,
      jobId: result.job._id,
      durationMs: result.job.durationMs || 0
    });

    if (result.job.status === "blocked") {
      haltedAt = {
        step: step.step,
        reason: "blocked_by_constraints_or_runtime"
      };
      break;
    }

    if (
      (result.job.status === "failed" || result.job.status === "timeout") &&
      !step.continueOnFailure
    ) {
      haltedAt = {
        step: step.step,
        reason: "step_failed_or_timed_out"
      };
      break;
    }
  }

  return {
    engagementId: String(engagement._id),
    targetUrl: engagement.targetUrl,
    source,
    stepsPlanned: steps.length,
    stepsExecuted: chainResults.length,
    haltedAt,
    chainResults
  };
}

module.exports = {
  runExploitationChain,
  __internal: {
    buildHeuristicChainSteps,
    sanitizeChainSteps
  }
};
