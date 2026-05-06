const cron = require("node-cron");
const Engagement = require("../models/Engagement");
const { orchestrateSingle } = require("../services/orchestrator");
const { createSnapshot, detectChanges } = require("../services/changeDetector");
const { logger } = require("../config/logger");

let task = null;

function isEnabled() {
  return process.env.CONTINUOUS_SCAN_ENABLED === "true";
}

function getSchedule() {
  return process.env.CONTINUOUS_SCAN_CRON || "0 6 * * *";
}

function getTimezone() {
  return process.env.CONTINUOUS_SCAN_TIMEZONE || "UTC";
}

async function runMonitoringCycle() {
  const activeEngagements = await Engagement.find({
    status: { $in: ["completed", "running"] }
  })
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  for (const engagement of activeEngagements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await orchestrateSingle(String(engagement._id), "monitoring-job");
      // eslint-disable-next-line no-await-in-loop
      await createSnapshot(
        String(engagement._id),
        "scheduled",
        "monitoring-job"
      );
      // eslint-disable-next-line no-await-in-loop
      const delta = await detectChanges(String(engagement._id));
      logger.info(
        {
          job: "monitoring",
          targetUrl: engagement.targetUrl,
          result: delta.changesFound ? "changes_detected" : "no_changes"
        },
        "Monitoring cycle processed engagement"
      );
    } catch (error) {
      logger.error(
        {
          job: "monitoring",
          targetUrl: engagement.targetUrl,
          error: error.message
        },
        "Monitoring cycle failed for engagement"
      );
    }
  }
}

function startMonitoringJob() {
  if (!isEnabled()) {
    logger.info(
      { job: "monitoring" },
      "Disabled (CONTINUOUS_SCAN_ENABLED != true)"
    );
    return;
  }

  if (task) {
    return;
  }

  const schedule = getSchedule();
  if (!cron.validate(schedule)) {
    logger.error({ job: "monitoring", schedule }, "Invalid cron schedule");
    return;
  }

  task = cron.schedule(
    schedule,
    async () => {
      try {
        logger.info({ job: "monitoring" }, "Starting scheduled monitoring cycle");
        await runMonitoringCycle();
      } catch (error) {
        logger.error(
          { job: "monitoring", error: error.message },
          "Monitoring cycle failed"
        );
      }
    },
    { timezone: getTimezone() }
  );

  logger.info(
    { job: "monitoring", cron: schedule, timezone: getTimezone() },
    "Monitoring job scheduled"
  );
}

function stopMonitoringJob() {
  if (!task) {
    return;
  }
  task.stop();
  task.destroy();
  task = null;
}

module.exports = {
  startMonitoringJob,
  stopMonitoringJob,
  runMonitoringCycle
};
