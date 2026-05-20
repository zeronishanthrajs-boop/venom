const express = require("express");
const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const Pattern = require("../models/Pattern");
const Plan = require("../models/Plan");
const requireDb = require("../middleware/requireDb");
const {
  computeJobSummary,
  computeDailyTrend,
  computeWindowSuccessRate,
  generateAlerts,
  computeEngagementProgress,
  computeSecurityTrends
} = require("../services/metricsEngine");

const router = express.Router();

router.get("/overview", requireDb, async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 28, 90);
    const trendDays = Math.min(Number(req.query.trendDays) || 14, 60);

    const start = new Date();
    start.setDate(start.getDate() - days);

    const [engagements, jobs, patterns] = await Promise.all([
      Engagement.find().lean(),
      ExecutionJob.find({
        createdAt: { $gte: start }
      }).lean(),
      Pattern.find().lean()
    ]);

    const jobSummary = computeJobSummary(jobs);
    const dailyTrend = computeDailyTrend(jobs, trendDays);
    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(now.getDate() - 7);
    const previousStart = new Date(now);
    previousStart.setDate(now.getDate() - 14);
    const currentWeekSuccessRate = computeWindowSuccessRate(jobs, currentStart, now);
    const previousWeekSuccessRate = computeWindowSuccessRate(
      jobs,
      previousStart,
      currentStart
    );

    const engagementStatus = {
      total: engagements.length,
      draft: engagements.filter((item) => item.status === "draft").length,
      running: engagements.filter((item) => item.status === "running").length,
      paused: engagements.filter((item) => item.status === "paused").length,
      completed: engagements.filter((item) => item.status === "completed").length,
      failed: engagements.filter((item) => item.status === "failed").length
    };

    const patternSummary = {
      total: patterns.length,
      avgSuccessRate:
        patterns.length === 0
          ? 0
          : Number(
              (
                patterns.reduce(
                  (total, pattern) => total + (pattern.successRate || 0),
                  0
                ) / patterns.length
              ).toFixed(4)
            ),
      avgConfidence:
        patterns.length === 0
          ? 0
          : Number(
              (
                patterns.reduce(
                  (total, pattern) => total + (pattern.confidence || 0),
                  0
                ) / patterns.length
              ).toFixed(4)
            )
    };

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      windowDays: days,
      engagementStatus,
      jobSummary,
      patternSummary,
      weekOverWeek: {
        currentWeekSuccessRate,
        previousWeekSuccessRate,
        delta: Number((currentWeekSuccessRate - previousWeekSuccessRate).toFixed(4))
      },
      dailyTrend
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/alerts", requireDb, async (_req, res, next) => {
  try {
    const budgetUsd = Number(process.env.VENOM_MONTHLY_BUDGET_USD || 400);
    const [jobs, patterns] = await Promise.all([
      ExecutionJob.find().sort({ createdAt: -1 }).limit(1000).lean(),
      Pattern.find().lean()
    ]);

    const alerts = generateAlerts(jobs, patterns, budgetUsd);
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      budgetUsd,
      alerts
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/progress/:engagementId", requireDb, async (req, res, next) => {
  try {
    const { engagementId } = req.params;
    const [engagement, plans, jobs] = await Promise.all([
      Engagement.findById(engagementId).lean(),
      Plan.find({ engagementId }).lean(),
      ExecutionJob.find({ engagementId }).lean()
    ]);

    if (!engagement) {
      return res.status(404).json({
        error: "Engagement not found"
      });
    }

    const progress = computeEngagementProgress({
      engagement,
      plans,
      jobs
    });

    return res.status(200).json(progress);
  } catch (error) {
    if (error?.name === "CastError") {
      return res.status(400).json({
        error: "Invalid engagement id"
      });
    }
    return next(error);
  }
});

router.get("/progress", requireDb, async (_req, res, next) => {
  try {
    const [engagements, plans, jobs] = await Promise.all([
      Engagement.find().lean(),
      Plan.find().lean(),
      ExecutionJob.find().lean()
    ]);

    const plansByEngagement = new Map();
    const jobsByEngagement = new Map();

    for (const plan of plans) {
      const key = String(plan.engagementId);
      if (!plansByEngagement.has(key)) {
        plansByEngagement.set(key, []);
      }
      plansByEngagement.get(key).push(plan);
    }

    for (const job of jobs) {
      const key = String(job.engagementId);
      if (!jobsByEngagement.has(key)) {
        jobsByEngagement.set(key, []);
      }
      jobsByEngagement.get(key).push(job);
    }

    const progress = engagements.map((engagement) =>
      computeEngagementProgress({
        engagement,
        plans: plansByEngagement.get(String(engagement._id)) || [],
        jobs: jobsByEngagement.get(String(engagement._id)) || []
      })
    );

    return res.status(200).json(progress);
  } catch (error) {
    return next(error);
  }
});

router.get("/security-trends", requireDb, async (req, res, next) => {
  try {
    const jobs = await ExecutionJob.find().lean();
    const trends = computeSecurityTrends(jobs);
    return res.status(200).json(trends);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
