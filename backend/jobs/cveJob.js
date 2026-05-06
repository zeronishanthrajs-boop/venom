const cron = require("node-cron");
const { syncRecentCves } = require("../services/cveIngester");
const { logger } = require("../config/logger");

let scheduledTask = null;
let running = false;

function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function runCveSyncCycle(reason = "scheduled", options = {}) {
  if (running) {
    return {
      skipped: true,
      reason: "already-running"
    };
  }

  running = true;
  const startedAt = Date.now();
  try {
    const result = await syncRecentCves(options);
    const durationMs = Date.now() - startedAt;
    logger.info(
      {
        job: "cve-sync",
        reason,
        fetched: result.fetched,
        normalized: result.normalized,
        upserted: result.upsertedCount,
        durationMs
      },
      "CVE sync cycle complete"
    );
    return {
      ok: true,
      durationMs,
      ...result
    };
  } catch (error) {
    logger.error(
      { job: "cve-sync", reason, error: error.message },
      "CVE sync cycle failed"
    );
    return {
      ok: false,
      error: error.message
    };
  } finally {
    running = false;
  }
}

function startCveSyncJob() {
  if (process.env.ENABLE_CVE_SYNC_JOB !== "true") {
    return null;
  }

  if (scheduledTask) {
    return scheduledTask;
  }

  const schedule = process.env.CVE_SYNC_CRON || "0 2 * * *";
  const timezone = process.env.CVE_SYNC_TIMEZONE || "UTC";

  if (!cron.validate(schedule)) {
    logger.error({ job: "cve-sync", schedule }, "Invalid cron schedule");
    return null;
  }

  scheduledTask = cron.schedule(
    schedule,
    async () => {
      await runCveSyncCycle("cron");
    },
    {
      timezone
    }
  );

  logger.info(
    { job: "cve-sync", cron: schedule, timezone },
    "CVE sync job scheduled"
  );

  const bootstrapEnabled = process.env.CVE_SYNC_ON_STARTUP !== "false";
  if (bootstrapEnabled && process.env.NODE_ENV === "production") {
    const bootstrapDelayMs = Math.max(
      toInteger(process.env.CVE_SYNC_STARTUP_DELAY_MS, 10000),
      0
    );
    setTimeout(() => {
      void runCveSyncCycle("startup");
    }, bootstrapDelayMs);
  }

  return scheduledTask;
}

function stopCveSyncJob() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask.destroy();
    scheduledTask = null;
  }
}

module.exports = {
  runCveSyncCycle,
  startCveSyncJob,
  stopCveSyncJob
};
