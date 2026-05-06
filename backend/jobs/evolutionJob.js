const cron = require("node-cron");
const { evolvePrompts } = require("../services/promptEvolver");
const { logger } = require("../config/logger");

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
    logger.info(
      {
        job: "evolution",
        reason,
        evolvedCount: result.evolvedCount,
        skippedCount: result.skippedCount,
        durationMs
      },
      "Prompt evolution cycle complete"
    );
    return {
      ok: true,
      durationMs,
      ...result
    };
  } catch (error) {
    logger.error(
      { job: "evolution", reason, error: error.message },
      "Prompt evolution cycle failed"
    );
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
    logger.error({ job: "evolution", schedule }, "Invalid cron schedule");
    return null;
  }

  scheduledTask = cron.schedule(
    schedule,
    async () => {
      await runEvolutionCycle("cron");
    },
    { timezone }
  );

  logger.info(
    { job: "evolution", cron: schedule, timezone },
    "Evolution job scheduled"
  );
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
