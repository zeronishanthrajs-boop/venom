const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const { runTool } = require("./executor");
const { getTool } = require("../tooling/toolRegistry");
const { toCamelCaseDeep } = require("../utils/prettyPrint");
const { recordExecutionEvidence } = require("./evidenceRecorder");
const { notifyCriticalFindings } = require("./notifier");
const { broadcastToolResult, broadcastFinding } = require("./realtimeServer");
const { translateAllFindings } = require("./translator");
const { assertExecutionAllowed } = require("./trustControl");
const { logger } = require("../config/logger");
const {
  classifyError,
  createStructuredError,
  logError,
  logWarn
} = require("../utils/scanErrors");

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
  if (status === "not_applicable") {
    return 200;
  }
  if (status === "tool_not_installed") {
    return 424;
  }
  return 422;
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getToolTimeoutWithBufferMs(tool) {
  if (tool?.id === "http_headers_probe") {
    return 20000;
  }
  if (tool?.id === "tls_metadata_probe") {
    return 10000;
  }
  const baseTimeoutMs = Math.max(
    1000,
    toInteger(tool?.timeoutSeconds, 60) * 1000
  );
  const timeoutBufferMs = Math.max(
    1000,
    toInteger(process.env.TOOL_TIMEOUT_BUFFER_MS, 15000)
  );
  return baseTimeoutMs + timeoutBufferMs;
}

function runToolWithHardTimeout(toolId, targetUrl, timeoutMs) {
  const safeTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 75000;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const timeoutError = new Error(
        `Tool ${toolId} timed out after ${safeTimeoutMs}ms`
      );
      timeoutError.code = "TOOL_TIMEOUT";
      reject(timeoutError);
    }, safeTimeoutMs);
  });

  return Promise.race([runTool(toolId, targetUrl), timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

async function markEngagementRunningIfDraft(engagementId) {
  await Engagement.findOneAndUpdate(
    {
      _id: engagementId,
      status: "draft"
    },
    {
      $set: {
        status: "running"
      }
    }
  );
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

  await assertExecutionAllowed(String(engagement._id));

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
  await markEngagementRunningIfDraft(engagement._id);

  try {
    const toolTimeoutMs = getToolTimeoutWithBufferMs(tool);
    const output = toCamelCaseDeep(
      await runToolWithHardTimeout(toolId, targetUrl, toolTimeoutMs)
    );
    if (output?.status === "NOT_APPLICABLE") {
      job.status = "not_applicable";
    } else if (output?.status === "TOOL_NOT_INSTALLED") {
      job.status = "tool_not_installed";
    } else if (output?.status === "ERROR") {
      job.status = "failed";
    } else {
      job.status = "success";
    }
    job.output = output;
    const rawFindings = Array.isArray(output?.findings) ? output.findings : [];
    job.findings = rawFindings;
    if (
      process.env.TRANSLATE_FINDINGS_ON_COMPLETE !== "false" &&
      job.findings.length > 0
    ) {
      const translatedFindings = await translateAllFindings(rawFindings).catch(() => rawFindings);
      job.findings = translatedFindings;
      if (!job.output || typeof job.output !== "object") {
        job.output = {};
      }
      job.output.findings = translatedFindings;
    }
    if (typeof output?.stdout === "string") {
      job.rawOutput = output.stdout;
    } else if (typeof output?.rawOutput === "string") {
      job.rawOutput = output.rawOutput;
    }
  } catch (error) {
    const structuredError = createStructuredError(error);
    if (structuredError.errorCode === "TOOL_NOT_INSTALLED") {
      job.status = "tool_not_installed";
    } else if (error?.code === "TOOL_TIMEOUT" || /timed out/i.test(error?.message || "")) {
      job.status = "timeout";
    } else if (error?.code === "DOCKER_DISABLED") {
      job.status = "tool_not_installed";
    } else {
      job.status = "failed";
    }
    job.errorMessage = structuredError.failureReason || error?.message || "Execution failed";
    job.output = {
      ...structuredError,
      classifiedAs: classifyError(error)
    };
    job.findings = [];
    logError(logger, { engagementId, toolId, targetUrl, jobStatus: job.status }, "Tool execution failed", error);
  }

  job.finishedAt = new Date();
  job.durationMs = Date.now() - startedAtMs;
  await job.save();
  await markEngagementRunningIfDraft(job.engagementId);

  try {
    const { recordToolOutcome } = require("./attackGraphService");
    const learningFindings = Array.isArray(job.findings) ? job.findings : [];
    const learningSuccess =
      job.status === "success" &&
      learningFindings.length > 0 &&
      !job.errorMessage;

    await recordToolOutcome(
      String(engagement._id),
      toolId,
      learningFindings,
      learningSuccess
    );
  } catch (learningError) {
    logWarn(logger, { toolId }, "Attack graph learning update failed", learningError);
  }

  setImmediate(async () => {
    try {
      if (process.env.AUTO_DECISION_BRIEF_ON_PROBE !== "false") {
        const { generateDecisionBrief } = require("./decisionEngine");
        await generateDecisionBrief(String(job.engagementId));
      }
    } catch (error) {
      logError(logger, { engagementId: String(job.engagementId) }, "Auto decision brief failed", error);
    }
  });

  setImmediate(async () => {
    try {
      if (process.env.AUTO_SNAPSHOT_ON_PROBE !== "false") {
        const { createSnapshot } = require("./changeDetector");
        await createSnapshot(
          String(job.engagementId),
          "post-probe",
          userId || "unknown"
        );
      }
    } catch (error) {
      logError(logger, { engagementId: String(job.engagementId) }, "Auto snapshot failed", error);
    }
  });

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
    logWarn(logger, { engagementId: String(engagement._id), toolId }, "Realtime broadcast of tool result failed", realtimeError);
  }

  try {
    await recordExecutionEvidence(jobObject, userId);
  } catch (evidenceError) {
    logWarn(logger, { engagementId: String(job.engagementId), toolId }, "Execution evidence persistence failed", evidenceError);
  }

  try {
    await notifyCriticalFindings({
      engagementId: String(engagement._id),
      engagementName: engagement.name || String(engagement._id),
      findings: jobObject.findings
    });
  } catch (notifyError) {
    logWarn(logger, { engagementId: String(engagement._id), toolId }, "Critical findings notification dispatch failed", notifyError);
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
