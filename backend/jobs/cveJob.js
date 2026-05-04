const cron = require("node-cron");
const { syncRecentCves } = require("../services/cveIngester");

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
    console.log(
      `[cve-job] ${reason} sync complete fetched=${result.fetched} normalized=${result.normalized} upserted=${result.upsertedCount} duration_ms=${durationMs}`
    );
    return {
      ok: true,
      durationMs,
      ...result
    };
  } catch (error) {
    console.error(`[cve-job] ${reason} sync failed:`, error.message);
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
    console.error(`[cve-job] invalid cron schedule: ${schedule}`);
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

  console.log(`[cve-job] scheduled cron='${schedule}' timezone='${timezone}'`);

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
