const { getTool } = require("../tooling/toolRegistry");

const TERMINAL_STATUSES = new Set(["success", "failed", "timeout", "blocked"]);

function toDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

function estimateJobCostUsd(job) {
  const tool = getTool(job.toolId);
  const base = typeof tool?.estimatedCostUsd === "number" ? tool.estimatedCostUsd : 0.01;
  const durationMinutes = Math.max(1, Math.ceil((job.durationMs || 0) / 60000));
  return Number((base * durationMinutes).toFixed(4));
}

function extractFindingCount(job) {
  const output = job.output || {};
  let findings = 0;

  if (Array.isArray(job.findings)) {
    findings += job.findings.length;
  }

  if (Array.isArray(output.missingRecommendedHeaders)) {
    findings += output.missingRecommendedHeaders.length;
  }

  if (output.authorizationError) {
    findings += 1;
  }

  if (typeof output.stdout === "string") {
    const failMatches = (output.stdout.match(/\bFAIL\b/gi) || []).length;
    const warnMatches = (output.stdout.match(/\bWARN(?:ING)?\b/gi) || []).length;
    findings += failMatches + Math.ceil(warnMatches / 2);
  }

  return findings;
}

function severityRank(severity) {
  if (severity === "critical") {
    return 4;
  }
  if (severity === "high") {
    return 3;
  }
  if (severity === "medium") {
    return 2;
  }
  if (severity === "low") {
    return 1;
  }
  return 0;
}

function computeJobSummary(jobs) {
  const terminalJobs = jobs.filter((job) => isTerminalStatus(job.status));
  const successfulJobs = terminalJobs.filter((job) => job.status === "success");
  const failedJobs = terminalJobs.filter(
    (job) => job.status === "failed" || job.status === "timeout" || job.status === "blocked"
  );
  const runningJobs = jobs.filter((job) => job.status === "running" || job.status === "queued");
  const totalDurationMs = terminalJobs.reduce(
    (total, job) => total + (Number(job.durationMs) || 0),
    0
  );
  const totalCostUsd = jobs.reduce((total, job) => total + estimateJobCostUsd(job), 0);
  const findingsCount = jobs.reduce((total, job) => total + extractFindingCount(job), 0);
  const successRate =
    terminalJobs.length === 0
      ? 0
      : Number((successfulJobs.length / terminalJobs.length).toFixed(4));

  return {
    totalJobs: jobs.length,
    terminalJobs: terminalJobs.length,
    runningJobs: runningJobs.length,
    successfulJobs: successfulJobs.length,
    failedJobs: failedJobs.length,
    successRate,
    avgDurationSeconds:
      terminalJobs.length === 0
        ? 0
        : Number(((totalDurationMs / terminalJobs.length) / 1000).toFixed(2)),
    totalDurationMinutes: Number((totalDurationMs / 60000).toFixed(2)),
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    findingsCount
  };
}

function computeDailyTrend(jobs, days = 14) {
  const today = new Date();
  const keys = [];
  const byDay = new Map();

  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = toDayKey(d);
    keys.push(key);
    byDay.set(key, {
      day: key,
      jobs: 0,
      success: 0,
      failed: 0,
      costUsd: 0,
      findings: 0
    });
  }

  for (const job of jobs) {
    const createdAt = job.createdAt ? new Date(job.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      continue;
    }

    const key = toDayKey(createdAt);
    const row = byDay.get(key);
    if (!row) {
      continue;
    }

    row.jobs += 1;
    if (job.status === "success") {
      row.success += 1;
    }
    if (job.status === "failed" || job.status === "timeout" || job.status === "blocked") {
      row.failed += 1;
    }
    row.costUsd = Number((row.costUsd + estimateJobCostUsd(job)).toFixed(4));
    row.findings += extractFindingCount(job);
  }

  return keys.map((key) => byDay.get(key));
}

function computeWindowSuccessRate(jobs, windowStart, windowEnd) {
  const windowJobs = jobs.filter((job) => {
    const createdAt = job.createdAt ? new Date(job.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      return false;
    }
    return createdAt >= windowStart && createdAt < windowEnd && isTerminalStatus(job.status);
  });

  if (windowJobs.length === 0) {
    return 0;
  }

  const successes = windowJobs.filter((job) => job.status === "success").length;
  return Number((successes / windowJobs.length).toFixed(4));
}

function generateAlerts(jobs, patterns, budgetUsd = 400) {
  const alerts = [];
  const now = new Date();

  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(now.getDate() - 14);

  const currentWeekRate = computeWindowSuccessRate(jobs, sevenDaysAgo, now);
  const previousWeekRate = computeWindowSuccessRate(jobs, fourteenDaysAgo, sevenDaysAgo);
  if (
    previousWeekRate > 0 &&
    currentWeekRate < previousWeekRate &&
    previousWeekRate - currentWeekRate >= 0.05
  ) {
    alerts.push({
      id: "success-rate-drop",
      severity: "high",
      title: "Success Rate Dropped",
      message: `Last 7 days success rate ${(currentWeekRate * 100).toFixed(
        1
      )}% is down from ${(previousWeekRate * 100).toFixed(1)}%.`
    });
  }

  for (const pattern of patterns) {
    const outcomes = Array.isArray(pattern.recentOutcomes) ? pattern.recentOutcomes : [];
    if (outcomes.length >= 5) {
      const lastFive = outcomes.slice(-5);
      const allFailures = lastFive.every((outcome) => outcome === false);
      if (allFailures) {
        alerts.push({
          id: `pattern-failure-streak-${pattern._id}`,
          severity: "medium",
          title: "Pattern Failure Streak",
          message: `${pattern.name} failed in the last 5 consecutive outcomes.`
        });
      }
    }
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyCost = jobs
    .filter((job) => {
      const createdAt = job.createdAt ? new Date(job.createdAt) : null;
      return createdAt && createdAt >= monthStart;
    })
    .reduce((total, job) => total + estimateJobCostUsd(job), 0);

  if (monthlyCost > budgetUsd) {
    alerts.push({
      id: "budget-exceeded",
      severity: "high",
      title: "Monthly Cost Threshold Exceeded",
      message: `Estimated monthly cost $${monthlyCost.toFixed(
        2
      )} exceeded budget $${budgetUsd.toFixed(2)}.`
    });
  } else if (monthlyCost > budgetUsd * 0.8) {
    alerts.push({
      id: "budget-warning",
      severity: "low",
      title: "Monthly Cost Near Threshold",
      message: `Estimated monthly cost is at ${((monthlyCost / budgetUsd) * 100).toFixed(
        1
      )}% of budget.`
    });
  }

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastDayTerminal = jobs.filter((job) => {
    const createdAt = job.createdAt ? new Date(job.createdAt) : null;
    return createdAt && createdAt >= dayAgo && isTerminalStatus(job.status);
  });
  if (lastDayTerminal.length >= 5) {
    const timeoutCount = lastDayTerminal.filter((job) => job.status === "timeout").length;
    const timeoutRatio = timeoutCount / lastDayTerminal.length;
    if (timeoutRatio >= 0.3) {
      alerts.push({
        id: "timeout-spike",
        severity: "medium",
        title: "Timeout Spike Detected",
        message: `${timeoutCount}/${lastDayTerminal.length} terminal jobs timed out in the last 24h.`
      });
    }
  }

  const recentJobs = jobs.filter((job) => {
    const createdAt = job.createdAt ? new Date(job.createdAt) : null;
    return createdAt && createdAt >= dayAgo;
  });

  const findingAlerts = [];
  for (const job of recentJobs) {
    if (!Array.isArray(job.findings)) {
      continue;
    }

    for (const finding of job.findings) {
      const sev = finding?.severity || "low";
      if (severityRank(sev) < severityRank("medium")) {
        continue;
      }

      findingAlerts.push({
        id: `finding-${job._id}-${finding.id || finding.title || "unknown"}`,
        severity: sev === "critical" ? "high" : sev,
        title: finding.title || "Security finding detected",
        message: `${finding.description || "Review finding details."} (tool=${job.toolId}${
          finding.cve ? `, ${finding.cve}` : ""
        })`
      });
    }
  }

  if (findingAlerts.length > 0) {
    alerts.push(...findingAlerts.slice(0, 10));
  }

  return alerts;
}

function computeEngagementProgress({ engagement, plans, jobs }) {
  const totalJobs = jobs.length;
  const terminalJobs = jobs.filter((job) => isTerminalStatus(job.status)).length;
  const learnedJobs = jobs.filter((job) => Boolean(job.learnedAt)).length;
  const findings = jobs.reduce((total, job) => total + extractFindingCount(job), 0);

  let progressPercent = 10;
  let currentPhase = "initialized";

  if (plans.length > 0) {
    progressPercent += 20;
    currentPhase = "planning-ready";
  }

  if (totalJobs > 0) {
    progressPercent += Math.round((terminalJobs / totalJobs) * 40);
    currentPhase = terminalJobs < totalJobs ? "execution-running" : "execution-complete";
    progressPercent += Math.round((learnedJobs / totalJobs) * 30);
    if (learnedJobs === totalJobs && totalJobs > 0) {
      currentPhase = "learning-complete";
    }
  }

  progressPercent = Math.max(0, Math.min(progressPercent, 100));

  return {
    engagementId: engagement._id,
    status: engagement.status,
    currentPhase,
    progressPercent,
    stats: {
      plansGenerated: plans.length,
      totalJobs,
      terminalJobs,
      learnedJobs,
      findings
    }
  };
}

module.exports = {
  estimateJobCostUsd,
  extractFindingCount,
  computeJobSummary,
  computeDailyTrend,
  computeWindowSuccessRate,
  generateAlerts,
  computeEngagementProgress
};
