const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const { runTool } = require("./executor");
const { getTool } = require("../tooling/toolRegistry");
const { toCamelCaseDeep } = require("../utils/prettyPrint");
const { recordExecutionEvidence } = require("./evidenceRecorder");
const { notifyCriticalFindings } = require("./notifier");
const { broadcastToolResult, broadcastFinding } = require("./realtimeServer");

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.httpStatus = statusCode;
  return error;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPatternRegExp(pattern) {
  return new RegExp(
    `^${escapeRegExp(pattern.toLowerCase()).replace(/\\\*/g, ".*")}$`
  );
}

function matchesAnyDomain(hostname, allowedDomains) {
  if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) {
    return true;
  }

  return allowedDomains.some((domainPattern) =>
    toPatternRegExp(domainPattern).test(hostname.toLowerCase())
  );
}

function validateTargetUrlAgainstScope(targetUrl, engagement) {
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (_error) {
    return "targetUrl must be a valid URL";
  }

  if (!matchesAnyDomain(parsedUrl.hostname, engagement.scope?.allowedDomains || [])) {
    return `Target domain ${parsedUrl.hostname} is not in allowedDomains`;
  }

  const blockedPath = (engagement.scope?.restrictedPaths || []).find((restrictedPath) =>
    parsedUrl.pathname.startsWith(restrictedPath)
  );
  if (blockedPath) {
    return `Target path ${parsedUrl.pathname} is restricted by ${blockedPath}`;
  }

  return null;
}

function mapJobStatusToHttpStatus(status) {
  if (status === "success") {
    return 201;
  }
  if (status === "blocked") {
    return 403;
  }
  if (status === "timeout") {
    return 504;
  }
  return 422;
}

async function executeEngagementTool({
  engagementId,
  toolId,
  requestedTargetUrl,
  userId = "unknown"
}) {
  if (!engagementId || typeof engagementId !== "string") {
    throw createHttpError(400, "engagementId is required");
  }

  if (!toolId || typeof toolId !== "string") {
    throw createHttpError(400, "toolId is required");
  }

  const tool = getTool(toolId);
  if (!tool) {
    throw createHttpError(400, `Unknown toolId: ${toolId}`);
  }

  const engagement = await Engagement.findById(engagementId).lean();
  if (!engagement) {
    throw createHttpError(404, "Engagement not found");
  }

  if (
    engagement.authorization?.validUntil &&
    new Date(engagement.authorization.validUntil) < new Date()
  ) {
    throw createHttpError(403, "Cannot execute tools for expired authorization");
  }

  const whitelist = engagement.constraints?.toolWhitelist || [];
  if (whitelist.length > 0 && !whitelist.includes(toolId)) {
    throw createHttpError(
      403,
      `Tool ${toolId} is not permitted by engagement tool whitelist`
    );
  }

  if (engagement.constraints?.noDestructiveOps && tool.destructive) {
    throw createHttpError(403, "Destructive tools are not allowed by engagement constraints");
  }

  const targetUrl = requestedTargetUrl || engagement.targetUrl;
  const scopeError = validateTargetUrlAgainstScope(targetUrl, engagement);
  if (scopeError) {
    throw createHttpError(403, scopeError);
  }

  const startedAtMs = Date.now();
  const job = await ExecutionJob.create({
    engagementId: engagement._id,
    toolId,
    targetUrl,
    status: "running",
    startedAt: new Date(),
    createdBy: userId
  });

  try {
    const output = toCamelCaseDeep(await runTool(toolId, targetUrl));
    job.status = "success";
    job.output = output;
    job.findings = Array.isArray(output?.findings) ? output.findings : [];
    if (typeof output?.stdout === "string") {
      job.rawOutput = output.stdout;
    } else if (typeof output?.rawOutput === "string") {
      job.rawOutput = output.rawOutput;
    }
  } catch (error) {
    if (error?.code === "DOCKER_DISABLED") {
      job.status = "blocked";
    } else if (/timed out/i.test(error?.message || "")) {
      job.status = "timeout";
    } else {
      job.status = "failed";
    }
    job.errorMessage = error?.message || "Execution failed";
    job.findings = [];
  }

  job.finishedAt = new Date();
  job.durationMs = Date.now() - startedAtMs;
  await job.save();

  const jobObject = job.toObject();

  try {
    broadcastToolResult(String(engagement._id), {
      jobId: String(jobObject._id),
      toolId,
      status: jobObject.status,
      durationMs: jobObject.durationMs || 0,
      findingsCount: Array.isArray(jobObject.findings)
        ? jobObject.findings.length
        : 0
    });
    for (const finding of Array.isArray(jobObject.findings) ? jobObject.findings : []) {
      broadcastFinding(String(engagement._id), {
        toolId,
        finding
      });
    }
  } catch (realtimeError) {
    console.warn("[Realtime] Unable to broadcast tool result:", realtimeError.message);
  }

  try {
    await recordExecutionEvidence(jobObject, userId);
  } catch (evidenceError) {
    console.warn(
      "[Evidence] Unable to persist execution evidence:",
      evidenceError.message
    );
  }

  try {
    await notifyCriticalFindings({
      engagementId: String(engagement._id),
      engagementName: engagement.name || String(engagement._id),
      findings: jobObject.findings
    });
  } catch (notifyError) {
    console.warn("[Notifier] Unable to dispatch alerts:", notifyError.message);
  }

  return {
    job: jobObject,
    httpStatus: mapJobStatusToHttpStatus(job.status)
  };
}

module.exports = {
  executeEngagementTool,
  validateTargetUrlAgainstScope,
  mapJobStatusToHttpStatus
};
