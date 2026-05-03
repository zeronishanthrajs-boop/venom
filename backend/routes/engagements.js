const express = require("express");
const Engagement = require("../models/Engagement");
const Plan = require("../models/Plan");
const ExecutionJob = require("../models/ExecutionJob");
const Pattern = require("../models/Pattern");
const engagementConstraints = require("../middleware/engagementConstraints");
const requireDb = require("../middleware/requireDb");
const { scorePatternForEngagement } = require("../services/patternEngine");

const router = express.Router();

function toEngagementPayload(body, userId) {
  return {
    name: body.name,
    description: body.description || "",
    targetUrl: body.targetUrl,
    targetType: body.targetType || "website",
    scope: {
      allowedDomains: body.scope?.allowedDomains || [],
      allowedIpRanges: body.scope?.allowedIpRanges || [],
      restrictedPaths: body.scope?.restrictedPaths || [],
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
      toolWhitelist: body.constraints?.toolWhitelist || [],
      noDestructiveOps:
        body.constraints?.noDestructiveOps === undefined
          ? true
          : Boolean(body.constraints?.noDestructiveOps),
      quietMode: Boolean(body.constraints?.quietMode),
      maxConcurrentOps: body.constraints?.maxConcurrentOps || 1,
      timeoutMinutes: body.constraints?.timeoutMinutes || 60
    },
    status: body.status || "draft",
    createdBy: userId
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

  return {
    generatedAt: new Date().toISOString(),
    engagement,
    summary: {
      totalPlans: plans.length,
      ...jobSummary
    },
    latestPlan: plans[0] || null,
    latestExecutionJob: executionJobs[0] || null,
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
      lines.push(JSON.stringify(plan, null, 2));
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
      lines.push(JSON.stringify(job, null, 2));
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

    return res.status(200).json(engagements);
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

    const [plans, executionJobs, patterns] = await Promise.all([
      Plan.find({ engagementId: engagement._id })
        .sort({ createdAt: -1 })
        .lean(),
      ExecutionJob.find({ engagementId: engagement._id })
        .sort({ createdAt: -1 })
        .lean(),
      Pattern.find().sort({ successRate: -1, recentSuccessRate: -1 }).limit(200).lean()
    ]);

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

    const [planDeleteResult, jobDeleteResult] = await Promise.all([
      Plan.deleteMany({ engagementId: engagement._id }),
      ExecutionJob.deleteMany({ engagementId: engagement._id })
    ]);

    await Engagement.deleteOne({ _id: engagement._id });

    return res.status(200).json({
      ok: true,
      deletedEngagementId: String(engagement._id),
      plansDeleted: planDeleteResult.deletedCount || 0,
      executionJobsDeleted: jobDeleteResult.deletedCount || 0
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
