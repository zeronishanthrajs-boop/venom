const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const { executeEngagementTool } = require("./executionService");
const { getTool } = require("../tooling/toolRegistry");
const { resolvePromptContent } = require("./promptCatalog");
const { callGeminiText } = require("./geminiClient");

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

const HALT_REASON_MAP = {
  scope_violation:
    "Blocked - target URL is outside the authorized domain scope.",
  docker_disabled:
    "Blocked - this tool requires Docker, which is not enabled on this server.",
  timeout: "Blocked - tool execution exceeded the timeout limit.",
  auth_expired: "Blocked - engagement authorization window has expired.",
  tool_not_found: "Blocked - requested tool is not registered in the tool registry.",
  step_failed_or_timed_out: "Blocked - a required step failed or timed out.",
  default: "Blocked - runtime error during execution. Check server logs for detail."
};

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
  const dockerEnabled = process.env.ENABLE_DOCKER_TOOLS === "true";

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
    const toolMode = String(tool.mode || "").toLowerCase();
    if ((toolMode === "docker" || toolMode === "docker-real") && !dockerEnabled) {
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

function inferHaltCode(jobResult) {
  const status = String(jobResult?.status || "").toLowerCase();
  const errorMessage = String(jobResult?.errorMessage || "").toLowerCase();

  if (status === "timeout") {
    return "timeout";
  }
  if (/outside the authorized|alloweddomains|restricted by/.test(errorMessage)) {
    return "scope_violation";
  }
  if (/docker/.test(errorMessage)) {
    return "docker_disabled";
  }
  if (/expired authorization/.test(errorMessage)) {
    return "auth_expired";
  }
  if (/unknown toolid|unsupported tool|no executor registered/.test(errorMessage)) {
    return "tool_not_found";
  }
  if (status === "failed" || status === "blocked") {
    return "step_failed_or_timed_out";
  }
  return "default";
}

function describeHaltReason(code) {
  return HALT_REASON_MAP[code] || HALT_REASON_MAP.default;
}

function inferHaltCodeFromError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (error?.httpStatus === 403 && /authorization/.test(message)) {
    return "auth_expired";
  }
  if (
    error?.httpStatus === 403 &&
    (/outside the authorized|alloweddomains|restricted by/.test(message) ||
      /scope/.test(message))
  ) {
    return "scope_violation";
  }
  if (/docker/.test(message)) {
    return "docker_disabled";
  }
  if (/unknown toolid|unsupported tool|no executor registered/.test(message)) {
    return "tool_not_found";
  }
  return "default";
}

async function tryGeminiChainPlan(engagement, findings) {
  const apiKey = process.env.GEMINI_API_KEY;
  const geminiEnabled = process.env.GEMINI_CHAIN_ENABLED !== "false";
  if (!apiKey || !geminiEnabled) {
    return null;
  }

  const model = process.env.GEMINI_CHAIN_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash";
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

  const response = await callGeminiText({
    apiKey,
    model,
    systemInstruction: instructions,
    userPrompt: `Generate the best next-step chain for this engagement.\n\n${JSON.stringify(
      {
        scopeSnapshot,
        findings: findings.slice(0, 20)
      },
      null,
      2
    )}`,
    temperature: 0.1,
    maxOutputTokens: 900
  }).catch(() => null);

  if (!response) {
    return null;
  }

  const text = response.text || "";
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

  const geminiSteps = await tryGeminiChainPlan(engagement, findings);
  const source = Array.isArray(geminiSteps) ? "gemini" : "heuristic";
  const rawSteps =
    Array.isArray(geminiSteps) && geminiSteps.length > 0
      ? geminiSteps
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
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await executeEngagementTool({
        engagementId: String(engagement._id),
        toolId: step.toolId,
        requestedTargetUrl: engagement.targetUrl,
        userId: createdBy
      });
    } catch (error) {
      const haltCode = inferHaltCodeFromError(error);
      haltedAt = {
        step: step.step,
        reason: haltCode,
        haltCode,
        haltReason: describeHaltReason(haltCode)
      };
      chainResults.push({
        step: step.step,
        toolId: step.toolId,
        name: step.name,
        rationale: step.rationale,
        status: "blocked",
        findings: 0,
        jobId: "",
        durationMs: 0,
        errorMessage: error?.message || "Chain step failed before execution."
      });
      break;
    }

    chainResults.push({
      step: step.step,
      toolId: step.toolId,
      name: step.name,
      rationale: step.rationale,
      status: result.job.status,
      findings: Array.isArray(result.job.findings) ? result.job.findings.length : 0,
      jobId: result.job._id,
      durationMs: result.job.durationMs || 0,
      errorMessage: result.job.errorMessage || ""
    });

    if (result.job.status === "blocked") {
      const haltCode = inferHaltCode(result.job);
      haltedAt = {
        step: step.step,
        reason: haltCode,
        haltCode,
        haltReason: describeHaltReason(haltCode)
      };
      break;
    }

    if (
      (result.job.status === "failed" || result.job.status === "timeout") &&
      !step.continueOnFailure
    ) {
      const haltCode = inferHaltCode(result.job);
      haltedAt = {
        step: step.step,
        reason: haltCode,
        haltCode,
        haltReason: describeHaltReason(haltCode)
      };
      break;
    }
  }

  const chainStatus = {
    executedSteps: chainResults.length,
    totalSteps: steps.length,
    haltedAtStep: haltedAt?.step || null,
    haltReason: haltedAt?.haltReason || null,
    haltCode: haltedAt?.haltCode || null
  };

  const persistedJobIds = chainResults
    .map((item) => item.jobId)
    .filter((id) => Boolean(id));

  if (persistedJobIds.length > 0) {
    await ExecutionJob.updateMany(
      {
        _id: {
          $in: persistedJobIds
        }
      },
      {
        $set: {
          "output.chainStatus": chainStatus
        }
      }
    );
  }

  return {
    engagementId: String(engagement._id),
    targetUrl: engagement.targetUrl,
    source,
    stepsPlanned: steps.length,
    stepsExecuted: chainResults.length,
    haltedAt,
    chainResults,
    chainStatus
  };
}

module.exports = {
  runExploitationChain,
  __internal: {
    buildHeuristicChainSteps,
    sanitizeChainSteps
  }
};
