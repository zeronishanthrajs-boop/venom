const express = require("express");
const Engagement = require("../models/Engagement");
const Plan = require("../models/Plan");
const ExecutionJob = require("../models/ExecutionJob");
const Pattern = require("../models/Pattern");
const Evidence = require("../models/Evidence");
const engagementConstraints = require("../middleware/engagementConstraints");
const requireDb = require("../middleware/requireDb");
const { scorePatternForEngagement } = require("../services/patternEngine");
const { PROMPT_VERSION } = require("../services/planner");
const { toCamelCaseDeep, toPrettyPrintedJson } = require("../utils/prettyPrint");
const { STARTUP_SCAN_PROFILE } = require("../profiles/startupScan");

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string" && item.trim() !== "");
}

function mergeUniqueStringArrays(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    for (const item of normalizeStringArray(list)) {
      const normalized = item.trim();
      if (!normalized) {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
    }
  }
  return merged;
}

function shouldApplyStartupProfile(body) {
  const explicit = String(body?.scanProfile || "").toLowerCase() === "startup";
  const implicit =
    process.env.DEFAULT_STARTUP_PROFILE === "true" &&
    ["website", "api"].includes(String(body?.targetType || "website").toLowerCase());
  return explicit || implicit;
}

const router = express.Router();

async function reconcileDraftStatuses(engagements = []) {
  const draftIds = engagements
    .filter((item) => item?.status === "draft")
    .map((item) => item._id);
  if (draftIds.length === 0) {
    return engagements;
  }

  const activeJobIds = await ExecutionJob.distinct("engagementId", {
    engagementId: { $in: draftIds },
    status: { $in: ["queued", "running", "success", "failed", "blocked", "timeout"] }
  });
  if (activeJobIds.length === 0) {
    return engagements;
  }

  await Engagement.updateMany(
    {
      _id: { $in: activeJobIds },
      status: "draft"
    },
    {
      $set: { status: "running" }
    }
  );

  const activeIdSet = new Set(activeJobIds.map((id) => String(id)));
  return engagements.map((item) =>
    activeIdSet.has(String(item._id))
      ? {
          ...item,
          status: "running"
        }
      : item
  );
}

function toEngagementPayload(body, userId) {
  const applyStartup = shouldApplyStartupProfile(body);
  const startupConcern = String(body?.startupConcern || "").trim();
  const ownershipAssertion = String(body?.ownershipAssertion || "").trim();
  const descriptionSegments = [body.description || ""];
  if (startupConcern) {
    descriptionSegments.push(`Startup concern: ${startupConcern}`);
  }
  if (ownershipAssertion) {
    descriptionSegments.push(`Ownership assertion: ${ownershipAssertion}`);
  }

  const mergedRestrictedPaths = applyStartup
    ? mergeUniqueStringArrays(
        body.scope?.restrictedPaths || [],
        STARTUP_SCAN_PROFILE.restrictedPaths
      )
    : body.scope?.restrictedPaths || [];

  const startupWhitelist = applyStartup
    ? STARTUP_SCAN_PROFILE.toolWhitelist
    : [];
  const requestedWhitelist = body.constraints?.toolWhitelist || [];
  const mergedWhitelist = applyStartup
    ? mergeUniqueStringArrays(requestedWhitelist, startupWhitelist)
    : requestedWhitelist;

  return {
    name: body.name,
    description: descriptionSegments.filter(Boolean).join(" | "),
    targetUrl: body.targetUrl,
    targetType: body.targetType || "website",
    scope: {
      allowedDomains: body.scope?.allowedDomains || [],
      allowedIpRanges: body.scope?.allowedIpRanges || [],
      restrictedPaths: mergedRestrictedPaths,
      restrictedServices: body.scope?.restrictedServices || []
    },
    authorization: {
      engagementId: body.authorization?.engagementId || "",
      authorizedBy: body.authorization?.authorizedBy || "",
      validFrom: body.authorization?.validFrom || new Date().toISOString(),
      validUntil: body.authorization?.validUntil,
      scopeOfWork: body.authorization?.scopeOfWork || ""
    },
    constraints: {
      toolWhitelist: mergedWhitelist,
      noDestructiveOps:
        body.constraints?.noDestructiveOps === undefined
          ? applyStartup
            ? STARTUP_SCAN_PROFILE.noDestructiveOps
            : true
          : Boolean(body.constraints?.noDestructiveOps),
      quietMode:
        body.constraints?.quietMode === undefined
          ? applyStartup
            ? STARTUP_SCAN_PROFILE.quietMode
            : false
          : Boolean(body.constraints?.quietMode),
      maxConcurrentOps:
        body.constraints?.maxConcurrentOps ||
        (applyStartup ? STARTUP_SCAN_PROFILE.maxConcurrentOps : 1),
      timeoutMinutes:
        body.constraints?.timeoutMinutes ||
        (applyStartup ? STARTUP_SCAN_PROFILE.timeoutMinutes : 60)
    },
    status: body.status || "draft",
    createdBy: userId,
    startupProfileApplied: applyStartup
  };
}

function toSafeReportFileName(value) {
  if (!value || typeof value !== "string") {
    return "venom-engagement-report";
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "venom-engagement-report";
}

function buildPassiveReconFallbackPlan(engagement, createdBy) {
  return {
    engagementId: engagement._id,
    promptVersion: PROMPT_VERSION,
    plannerSource: "template",
    model: "passive-recon-fallback-v1",
    summary:
      "Passive reconnaissance fallback generated automatically to seed forensic metadata when no plan existed.",
    phases: [
      {
        name: "Passive reconnaissance bootstrap",
        goal: "Collect non-invasive baseline metadata for planning and scoring.",
        priorityScore: 10,
        riskLevel: "low",
        checks: [
          "Capture HTTP headers and response metadata within authorized scope.",
          "Collect DNS resolution and record consistency for the target hostname.",
          "Collect TLS certificate chain and protocol metadata without active exploitation."
        ],
        evidence: [
          "HTTP response/header fingerprint",
          "DNS lookup and resolver outputs",
          "TLS certificate subject/issuer/protocol details"
        ],
        stopConditions: [
          "Target scope mismatch is detected.",
          "Authorization window is expired or invalid.",
          "Any step requires non-read-only behavior."
        ]
      }
    ],
    riskNotes: [
      "Auto-fallback is read-only and non-destructive by design.",
      "Any escalation beyond passive reconnaissance requires operator approval."
    ],
    disclaimers: [
      "Generated due to missing prior plans to avoid empty forensic view.",
      "Plan remains constrained to defined engagement scope and authorization."
    ],
    inputSnapshot: {
      targetUrl: engagement.targetUrl,
      targetType: engagement.targetType,
      scope: engagement.scope,
      constraints: engagement.constraints,
      authorization: engagement.authorization
    },
    rawModelOutput: "",
    createdBy
  };
}

async function ensurePlansWithFallback(engagement, plans, userId) {
  if (Array.isArray(plans) && plans.length > 0) {
    return plans;
  }

  const fallbackPlan = await Plan.create(
    buildPassiveReconFallbackPlan(engagement, userId)
  );
  return [fallbackPlan.toObject()];
}

function summarizeExecutionJobs(executionJobs) {
  const summary = {
    totalExecutionJobs: executionJobs.length,
    successfulJobs: 0,
    failedJobs: 0,
    blockedJobs: 0,
    timeoutJobs: 0,
    runningJobs: 0
  };

  for (const job of executionJobs) {
    if (job.status === "success") {
      summary.successfulJobs += 1;
    } else if (job.status === "failed") {
      summary.failedJobs += 1;
    } else if (job.status === "blocked") {
      summary.blockedJobs += 1;
    } else if (job.status === "timeout") {
      summary.timeoutJobs += 1;
    } else if (job.status === "running") {
      summary.runningJobs += 1;
    }
  }

  return summary;
}

function buildEngagementReport({
  engagement,
  plans,
  executionJobs,
  patternMatches
}) {
  const jobSummary = summarizeExecutionJobs(executionJobs);
  const terminalCount =
    jobSummary.successfulJobs +
    jobSummary.failedJobs +
    jobSummary.blockedJobs +
    jobSummary.timeoutJobs;
  const successRate =
    terminalCount === 0
      ? 0
      : Number((jobSummary.successfulJobs / terminalCount).toFixed(4));

  return {
    generatedAt: new Date().toISOString(),
    engagement,
    summary: {
      totalPlans: plans.length,
      ...jobSummary,
      successRate
    },
    latestPlan: plans[0] || null,
    latestExecutionJob: executionJobs[0] || null,
    formatted: {
      latestPlanPretty: plans[0] ? toPrettyPrintedJson(plans[0]) : null,
      latestExecutionJobPretty: executionJobs[0]
        ? toPrettyPrintedJson(executionJobs[0])
        : null,
      latestPlanCamelCase: plans[0] ? toCamelCaseDeep(plans[0]) : null,
      latestExecutionJobCamelCase: executionJobs[0]
        ? toCamelCaseDeep(executionJobs[0])
        : null
    },
    patternMatches,
    plans,
    executionJobs
  };
}

function toMarkdownReport(report) {
  const lines = [];

  lines.push(`# VENOM Engagement Report`);
  lines.push("");
  lines.push(`Generated At: ${report.generatedAt}`);
  lines.push(`Engagement ID: ${report.engagement?._id}`);
  lines.push(`Name: ${report.engagement?.name || "Untitled"}`);
  lines.push(`Target URL: ${report.engagement?.targetUrl || "N/A"}`);
  lines.push(`Target Type: ${report.engagement?.targetType || "unknown"}`);
  lines.push(`Status: ${report.engagement?.status || "unknown"}`);
  lines.push("");

  lines.push("## Executive Summary");
  lines.push("");
  lines.push(
    `- Plans Generated: ${report.summary?.totalPlans || 0}`
  );
  lines.push(
    `- Jobs Run: ${report.summary?.totalExecutionJobs || 0}`
  );
  lines.push(
    `- Success: ${report.summary?.successfulJobs || 0}`
  );
  lines.push(
    `- Failed: ${report.summary?.failedJobs || 0}`
  );
  lines.push(
    `- Blocked: ${report.summary?.blockedJobs || 0}`
  );
  lines.push(
    `- Timeout: ${report.summary?.timeoutJobs || 0}`
  );
  lines.push("");

  lines.push("## Pattern Match Scores");
  lines.push("");
  if (!Array.isArray(report.patternMatches) || report.patternMatches.length === 0) {
    lines.push("- No ranked patterns available.");
  } else {
    report.patternMatches.forEach((pattern, index) => {
      lines.push(
        `${index + 1}. ${pattern.patternName} | score=${pattern.applicabilityScore} | confidence=${pattern.confidence} | reason=${pattern.reason}`
      );
    });
  }
  lines.push("");

  lines.push("## Plans");
  lines.push("");
  if (!Array.isArray(report.plans) || report.plans.length === 0) {
    lines.push("- No plans generated.");
    lines.push("");
  } else {
    report.plans.forEach((plan, index) => {
      lines.push(`### Plan ${index + 1}: ${plan._id}`);
      lines.push(`- Prompt Version: ${plan.promptVersion}`);
      lines.push(`- Source: ${plan.plannerSource}`);
      lines.push(`- Model: ${plan.model}`);
      lines.push(`- Created At: ${plan.createdAt}`);
      lines.push(`- Summary: ${plan.summary || "N/A"}`);
      lines.push("");
      lines.push("```json");
      lines.push(toPrettyPrintedJson(plan));
      lines.push("```");
      lines.push("");
    });
  }

  lines.push("## Execution Jobs (Technical)");
  lines.push("");
  if (
    !Array.isArray(report.executionJobs) ||
    report.executionJobs.length === 0
  ) {
    lines.push("- No execution jobs recorded.");
  } else {
    report.executionJobs.forEach((job, index) => {
      lines.push(`### Job ${index + 1}: ${job._id}`);
      lines.push(`- Tool: ${job.toolId}`);
      lines.push(`- Status: ${job.status}`);
      lines.push(`- Target: ${job.targetUrl}`);
      lines.push(`- Started: ${job.startedAt || "N/A"}`);
      lines.push(`- Finished: ${job.finishedAt || "N/A"}`);
      lines.push(`- Duration (ms): ${job.durationMs ?? "N/A"}`);
      if (job.errorMessage) {
        lines.push(`- Error: ${job.errorMessage}`);
      }
      lines.push("");
      lines.push("```json");
      lines.push(toPrettyPrintedJson(job));
      lines.push("```");
      lines.push("");
    });
  }

  return lines.join("\n");
}

router.post("/", engagementConstraints, requireDb, async (req, res, next) => {
  try {
    if (!req.body.name || typeof req.body.name !== "string") {
      return res.status(400).json({
        error: "name is required"
      });
    }

    const engagement = await Engagement.create(
      toEngagementPayload(req.body, req.user?.id || "unknown")
    );
    return res.status(201).json(engagement);
  } catch (error) {
    return next(error);
  }
});

router.get("/", requireDb, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const engagements = await Engagement.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const reconciled = await reconcileDraftStatuses(engagements);

    return res.status(200).json(reconciled);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", requireDb, async (req, res, next) => {
  try {
    const engagement = await Engagement.findById(req.params.id).lean();
    if (!engagement) {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    const hasAnyJobs = await ExecutionJob.exists({
      engagementId: engagement._id,
      status: { $in: ["queued", "running", "success", "failed", "blocked", "timeout"] }
    });
    if (engagement.status === "draft" && hasAnyJobs) {
      await Engagement.updateOne(
        { _id: engagement._id, status: "draft" },
        { $set: { status: "running" } }
      );
      engagement.status = "running";
    }

    return res.status(200).json(engagement);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

router.get("/:id/report", requireDb, async (req, res, next) => {
  try {
    const format = String(req.query.format || "json").toLowerCase();
    if (format !== "json" && format !== "markdown") {
      return res.status(400).json({
        error: "Unsupported report format. Use json or markdown."
      });
    }

    const engagement = await Engagement.findById(req.params.id).lean();
    if (!engagement) {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    const [rawPlans, executionJobs, patterns] = await Promise.all([
      Plan.find({ engagementId: engagement._id })
        .sort({ createdAt: -1 })
        .lean(),
      ExecutionJob.find({ engagementId: engagement._id })
        .sort({ createdAt: -1 })
        .lean(),
      Pattern.find().sort({ successRate: -1, recentSuccessRate: -1 }).limit(200).lean()
    ]);
    const plans = await ensurePlansWithFallback(
      engagement,
      rawPlans,
      req.user?.id || "system-auto-fallback"
    );

    const patternMatches = patterns
      .map((pattern) => scorePatternForEngagement(pattern, engagement))
      .sort((left, right) => right.applicabilityScore - left.applicabilityScore)
      .slice(0, 10);

    const report = buildEngagementReport({
      engagement,
      plans,
      executionJobs,
      patternMatches
    });

    if (format === "markdown") {
      const markdown = toMarkdownReport(report);
      const fileName = `${toSafeReportFileName(engagement.name)}-${engagement._id}.md`;
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      return res.status(200).send(markdown);
    }

    return res.status(200).json(report);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

router.delete("/:id", requireDb, async (req, res, next) => {
  try {
    const engagement = await Engagement.findById(req.params.id).lean();
    if (!engagement) {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    const [planDeleteResult, jobDeleteResult, evidenceDeleteResult] = await Promise.all([
      Plan.deleteMany({ engagementId: engagement._id }),
      ExecutionJob.deleteMany({ engagementId: engagement._id }),
      Evidence.deleteMany({ engagementId: engagement._id })
    ]);

    await Engagement.deleteOne({ _id: engagement._id });

    return res.status(200).json({
      ok: true,
      deletedEngagementId: String(engagement._id),
      plansDeleted: planDeleteResult.deletedCount || 0,
      executionJobsDeleted: jobDeleteResult.deletedCount || 0,
      evidenceDeleted: evidenceDeleteResult.deletedCount || 0
    });
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

module.exports = router;
