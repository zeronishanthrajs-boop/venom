const cron = require("node-cron");
const Engagement = require("../models/Engagement");
const { orchestrateSingle } = require("../services/orchestrator");
const { createSnapshot, detectChanges } = require("../services/changeDetector");

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
      console.log(
        `[MonitoringJob] ${engagement.targetUrl} -> ${
          delta.changesFound ? "changes_detected" : "no_changes"
        }`
      );
    } catch (error) {
      console.error(
        `[MonitoringJob] Failed for ${engagement.targetUrl}: ${error.message}`
      );
    }
  }
}

function startMonitoringJob() {
  if (!isEnabled()) {
    console.log("[MonitoringJob] Disabled (CONTINUOUS_SCAN_ENABLED != true).");
    return;
  }

  if (task) {
    return;
  }

  const schedule = getSchedule();
  if (!cron.validate(schedule)) {
    console.error(`[MonitoringJob] Invalid cron schedule: ${schedule}`);
    return;
  }

  task = cron.schedule(
    schedule,
    async () => {
      try {
        console.log("[MonitoringJob] Starting scheduled monitoring cycle...");
        await runMonitoringCycle();
      } catch (error) {
        console.error("[MonitoringJob] Monitoring cycle failed:", error.message);
      }
    },
    { timezone: getTimezone() }
  );

  console.log(
    `[MonitoringJob] Scheduled (${schedule}) timezone=${getTimezone()}`
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

