const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const requireDb = require("../middleware/requireDb");
const { runTool } = require("../services/executor");
const { getTool, listTools } = require("../tooling/toolRegistry");

const router = express.Router();

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

router.get("/tools", (_req, res) => {
  return res.status(200).json(listTools());
});

router.post("/", requireDb, async (req, res, next) => {
  try {
    const { engagementId, toolId } = req.body;
    const requestedTargetUrl = req.body.targetUrl;

    if (!engagementId || typeof engagementId !== "string") {
      return res.status(400).json({ error: "engagementId is required" });
    }

    if (!toolId || typeof toolId !== "string") {
      return res.status(400).json({ error: "toolId is required" });
    }

    const tool = getTool(toolId);
    if (!tool) {
      return res.status(400).json({ error: `Unknown toolId: ${toolId}` });
    }

    const engagement = await Engagement.findById(engagementId).lean();
    if (!engagement) {
      return res.status(404).json({ error: "Engagement not found" });
    }

    if (
      engagement.authorization?.validUntil &&
      new Date(engagement.authorization.validUntil) < new Date()
    ) {
      return res.status(403).json({
        error: "Cannot execute tools for expired authorization"
      });
    }

    const whitelist = engagement.constraints?.toolWhitelist || [];
    if (whitelist.length > 0 && !whitelist.includes(toolId)) {
      return res.status(403).json({
        error: `Tool ${toolId} is not permitted by engagement tool whitelist`
      });
    }

    if (engagement.constraints?.noDestructiveOps && tool.destructive) {
      return res.status(403).json({
        error: "Destructive tools are not allowed by engagement constraints"
      });
    }

    const targetUrl = requestedTargetUrl || engagement.targetUrl;
    const scopeError = validateTargetUrlAgainstScope(targetUrl, engagement);
    if (scopeError) {
      return res.status(403).json({ error: scopeError });
    }

    const now = Date.now();
    const job = await ExecutionJob.create({
      engagementId: engagement._id,
      toolId,
      targetUrl,
      status: "running",
      startedAt: new Date(),
      createdBy: req.user?.id || "unknown"
    });

    try {
      const output = await runTool(toolId, targetUrl);
      job.status = "success";
      job.output = output;
      if (typeof output?.stdout === "string") {
        job.rawOutput = output.stdout;
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
    }

    job.finishedAt = new Date();
    job.durationMs = Date.now() - now;
    await job.save();

    if (job.status === "success") {
      return res.status(201).json(job);
    }

    const statusCode =
      job.status === "blocked" ? 403 : job.status === "timeout" ? 504 : 422;
    return res.status(statusCode).json(job);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

router.get("/engagement/:engagementId", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find({
      engagementId: req.params.engagementId
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.status(200).json(jobs);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

router.get("/:id", requireDb, async (req, res, next) => {
  try {
    const job = await ExecutionJob.findById(req.params.id).lean();
    if (!job) {
      return res.status(404).json({ error: "Execution job not found" });
    }
    return res.status(200).json(job);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid execution job id"
      });
    }
    return next(error);
  }
});

module.exports = router;
