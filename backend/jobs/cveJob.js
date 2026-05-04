const { syncRecentCves } = require("../services/cveIngester");

let intervalHandle = null;
let running = false;

function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function runCveSyncCycle(reason = "scheduled") {
  if (running) {
    return {
      skipped: true,
      reason: "already-running"
    };
  }

  running = true;
  const startedAt = Date.now();
  try {
    const result = await syncRecentCves();
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

  const intervalMinutes = Math.max(toInteger(process.env.CVE_SYNC_INTERVAL_MINUTES, 360), 15);
  const intervalMs = intervalMinutes * 60 * 1000;

  if (intervalHandle) {
    return intervalHandle;
  }

  void runCveSyncCycle("startup");
  intervalHandle = setInterval(() => {
    void runCveSyncCycle("scheduled");
  }, intervalMs);

  console.log(`[cve-job] scheduled every ${intervalMinutes} minute(s)`);
  return intervalHandle;
}

function stopCveSyncJob() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  runCveSyncCycle,
  startCveSyncJob,
  stopCveSyncJob
};
