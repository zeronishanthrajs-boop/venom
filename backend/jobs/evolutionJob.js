const cron = require("node-cron");
const { evolvePrompts } = require("../services/promptEvolver");

let scheduledTask = null;
let running = false;

async function runEvolutionCycle(reason = "scheduled", options = {}) {
  if (running) {
    return {
      skipped: true,
      reason: "already-running"
    };
  }

  running = true;
  const startedAt = Date.now();
  try {
    const result = await evolvePrompts(options);
    const durationMs = Date.now() - startedAt;
    console.log(
      `[evolution-job] ${reason} prompt evolution complete evolved=${result.evolvedCount} skipped=${result.skippedCount} duration_ms=${durationMs}`
    );
    return {
      ok: true,
      durationMs,
      ...result
    };
  } catch (error) {
    console.error(`[evolution-job] ${reason} prompt evolution failed:`, error.message);
    return {
      ok: false,
      error: error.message
    };
  } finally {
    running = false;
  }
}

function startPromptEvolutionJob() {
  if (process.env.ENABLE_PROMPT_EVOLUTION_JOB !== "true") {
    return null;
  }

  if (scheduledTask) {
    return scheduledTask;
  }

  const schedule = process.env.PROMPT_EVOLUTION_CRON || "0 3 * * 0";
  const timezone = process.env.PROMPT_EVOLUTION_TIMEZONE || "UTC";
  if (!cron.validate(schedule)) {
    console.error(`[evolution-job] invalid cron schedule: ${schedule}`);
    return null;
  }

  scheduledTask = cron.schedule(
    schedule,
    async () => {
      await runEvolutionCycle("cron");
    },
    { timezone }
  );

  console.log(`[evolution-job] scheduled cron='${schedule}' timezone='${timezone}'`);
  return scheduledTask;
}

function stopPromptEvolutionJob() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask.destroy();
    scheduledTask = null;
  }
}

module.exports = {
  runEvolutionCycle,
  startPromptEvolutionJob,
  stopPromptEvolutionJob
};
