const Engagement = require("../models/Engagement");
const Plan = require("../models/Plan");
const { generatePlanForEngagement, PROMPT_VERSION } = require("./planner");
const { executeEngagementTool } = require("./executionService");
const { runLearningCycle } = require("./learner");
const { broadcastToRoom } = require("./realtimeServer");
const { assertExecutionAllowed } = require("./trustControl");
const { createSnapshot, detectChanges } = require("./changeDetector");

const DEFAULT_TOOL_SEQUENCE = {
  website: [
    "http_headers_probe",
    "dns_lookup_probe",
    "tls_metadata_probe",
    "nmap_tcp_scan",
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

const activeOrchestrations = new Map();

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMaxConcurrent() {
  return Math.max(1, toInteger(process.env.MAX_CONCURRENT_TARGETS, 3));
}

function normalizeToolId(toolId) {
  return String(toolId || "").trim();
}

function deriveToolSequenceFromPlan(plan, targetType) {
  if (!plan || !Array.isArray(plan.phases)) {
    return [...(DEFAULT_TOOL_SEQUENCE[targetType] || DEFAULT_TOOL_SEQUENCE.website)];
  }

  const sequence = [];
  const phaseText = plan.phases
    .map((phase) => `${phase.name || ""} ${phase.goal || ""} ${(phase.checks || []).join(" ")}`)
    .join(" ")
    .toLowerCase();

  // Always start with low-risk baseline probes.
  sequence.push("http_headers_probe", "dns_lookup_probe", "tls_metadata_probe");

  if (/network|port|service|exposed/.test(phaseText)) {
    sequence.push("nmap_tcp_scan");
  }
  if (/template|cve|vulnerab|misconfig|risk/.test(phaseText)) {
    sequence.push("nuclei_scan");
  }
  if (/server|config|header|hardening/.test(phaseText)) {
    sequence.push("nikto_scan");
  }
  if (/api|parameter|input|injection|sql/.test(phaseText)) {
    sequence.push("sqlmap_detect");
  }

  if (sequence.length <= 3) {
    sequence.push(...(DEFAULT_TOOL_SEQUENCE[targetType] || DEFAULT_TOOL_SEQUENCE.website));
  }

  const deduped = [];
  const seen = new Set();
  for (const item of sequence.map(normalizeToolId)) {
    if (!item || seen.has(item)) {
      continue;
    }
    deduped.push(item);
    seen.add(item);
  }
  return deduped;
}

function serializeActiveOrchestration(entry) {
  return {
    engagementId: entry.engagementId,
    targetUrl: entry.targetUrl,
    startedAt: entry.startedAt,
    startedBy: entry.startedBy,
    state: entry.state,
    step: entry.step,
    totalSteps: entry.totalSteps,
    lastUpdateAt: entry.lastUpdateAt
  };
}

function broadcastOrchestrationEvent(engagementId, event, payload) {
  try {
    broadcastToRoom(engagementId, event, payload);
  } catch {
    // no-op for orchestrator control flow
  }
}

function getOrchestratorStatus() {
  const active = {};
  for (const [engagementId, entry] of activeOrchestrations.entries()) {
    active[engagementId] = serializeActiveOrchestration(entry);
  }

  return {
    activeCount: activeOrchestrations.size,
    maxConcurrent: getMaxConcurrent(),
    active
  };
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.httpStatus = statusCode;
  return error;
}

async function persistGeneratedPlan(engagement, planningResult, createdBy) {
  return Plan.create({
    engagementId: engagement._id,
    promptVersion: planningResult.promptVersion || PROMPT_VERSION,
    plannerSource: planningResult.source || "template",
    model: planningResult.model || "template-planner-v1",
    summary: planningResult.plan?.summary || "",
    phases: planningResult.plan?.phases || [],
    riskNotes: planningResult.plan?.riskNotes || [],
    disclaimers: planningResult.plan?.disclaimers || [],
    inputSnapshot: {
      targetUrl: engagement.targetUrl,
      targetType: engagement.targetType,
      scope: engagement.scope,
      constraints: engagement.constraints,
      authorization: engagement.authorization
    },
    rawModelOutput: planningResult.rawModelOutput || "",
    createdBy
  });
}

async function orchestrateSingle(engagementId, userId = "unknown") {
  if (activeOrchestrations.has(engagementId)) {
    throw createHttpError(409, "Engagement is already being orchestrated");
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
    throw createHttpError(403, "Cannot orchestrate expired authorization");
  }

  activeOrchestrations.set(engagementId, {
    engagementId,
    targetUrl: engagement.targetUrl,
    startedAt: new Date().toISOString(),
    startedBy: userId,
    state: "planning",
    step: 0,
    totalSteps: 0,
    lastUpdateAt: new Date().toISOString()
  });

  const entry = activeOrchestrations.get(engagementId);
  try {
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "planning",
      engagementId
    });

    await Engagement.updateOne(
      { _id: engagement._id },
      { $set: { status: "running" } }
    );

    const planningResult = await generatePlanForEngagement(engagement);
    const savedPlan = await persistGeneratedPlan(engagement, planningResult, userId);
    const toolSequence = deriveToolSequenceFromPlan(
      planningResult.plan,
      engagement.targetType
    );

    entry.state = "executing";
    entry.totalSteps = toolSequence.length;
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "executing",
      engagementId,
      totalSteps: entry.totalSteps
    });

    const executionResults = [];
    for (let index = 0; index < toolSequence.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await assertExecutionAllowed(String(engagement._id));

      const toolId = toolSequence[index];
      entry.step = index + 1;
      entry.lastUpdateAt = new Date().toISOString();
      broadcastOrchestrationEvent(engagementId, "orchestration_step", {
        engagementId,
        step: entry.step,
        totalSteps: entry.totalSteps,
        toolId
      });

      // eslint-disable-next-line no-await-in-loop
      const execution = await executeEngagementTool({
        engagementId: String(engagement._id),
        toolId,
        requestedTargetUrl: engagement.targetUrl,
        userId
      });

      executionResults.push({
        toolId,
        status: execution.job.status,
        findings: Array.isArray(execution.job.findings) ? execution.job.findings.length : 0,
        durationMs: execution.job.durationMs || 0,
        jobId: execution.job._id
      });
    }

    entry.state = "learning";
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "learning",
      engagementId
    });
    const learningResult = await runLearningCycle(String(engagement._id));

    await Engagement.updateOne(
      { _id: engagement._id },
      { $set: { status: "completed", completedAt: new Date() } }
    );

    await createSnapshot(
      String(engagement._id),
      "post-engagement",
      userId
    ).catch(() => null);
    await detectChanges(String(engagement._id)).catch(() => null);

    entry.state = "completed";
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "completed",
      engagementId
    });
    return {
      engagementId: String(engagement._id),
      targetUrl: engagement.targetUrl,
      status: "completed",
      promptVersion: savedPlan.promptVersion,
      plannerSource: savedPlan.plannerSource,
      toolSequence,
      executionResults,
      learningResult
    };
  } catch (error) {
    await Engagement.updateOne(
      { _id: engagement._id },
      { $set: { status: "failed" } }
    ).catch(() => {});
    entry.state = "failed";
    entry.lastUpdateAt = new Date().toISOString();
    broadcastOrchestrationEvent(engagementId, "orchestration_state", {
      state: "failed",
      engagementId,
      error: error?.message || "orchestration failed"
    });
    throw error;
  } finally {
    setTimeout(() => {
      activeOrchestrations.delete(engagementId);
    }, 1500);
  }
}

async function orchestrateMultiple(engagementIds, userId = "unknown") {
  const uniqueIds = [...new Set((engagementIds || []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw createHttpError(400, "engagementIds must contain at least one id");
  }

  const maxConcurrent = getMaxConcurrent();
  const currentlyActive = activeOrchestrations.size;
  const availableSlots = Math.max(0, maxConcurrent - currentlyActive);
  if (availableSlots <= 0) {
    throw createHttpError(
      429,
      `Concurrency limit reached. Max ${maxConcurrent} active orchestrations.`
    );
  }

  const pending = uniqueIds.filter((id) => !activeOrchestrations.has(id));
  const scheduled = pending.slice(0, availableSlots);
  const skipped = uniqueIds
    .filter((id) => !scheduled.includes(id))
    .map((engagementId) => ({
      engagementId,
      reason: activeOrchestrations.has(engagementId)
        ? "already_active"
        : "max_concurrency_reached"
    }));

  const settled = await Promise.allSettled(
    scheduled.map((engagementId) => orchestrateSingle(engagementId, userId))
  );

  const results = settled.map((item, index) => ({
    engagementId: scheduled[index],
    status: item.status === "fulfilled" ? "fulfilled" : "rejected",
    result: item.status === "fulfilled" ? item.value : item.reason?.message || "unknown"
  }));

  return {
    requested: uniqueIds.length,
    scheduled: scheduled.length,
    skipped,
    maxConcurrent,
    currentlyActive,
    results
  };
}

module.exports = {
  orchestrateSingle,
  orchestrateMultiple,
  getOrchestratorStatus,
  __internal: {
    deriveToolSequenceFromPlan
  }
};
