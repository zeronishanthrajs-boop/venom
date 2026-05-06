const cron = require("node-cron");
const { runResearchCycle } = require("../services/researchEngine");
const { logger } = require("../config/logger");

let task = null;

function isEnabled() {
  return process.env.ENABLE_RESEARCH_JOB === "true";
}

function getSchedule() {
  return process.env.RESEARCH_JOB_CRON || "0 4 * * 2,5";
}

function getTimezone() {
  return process.env.RESEARCH_JOB_TIMEZONE || "UTC";
}

function startResearchJob() {
  if (!isEnabled()) {
    logger.info({ job: "research" }, "Disabled (ENABLE_RESEARCH_JOB != true)");
    return;
  }

  if (task) {
    return;
  }

  task = cron.schedule(
    getSchedule(),
    async () => {
      try {
        logger.info({ job: "research" }, "Starting scheduled research cycle");
        await runResearchCycle({
          trigger: "cron",
          createdBy: "research-job"
        });
      } catch (error) {
        logger.error(
          { job: "research", error: error.message },
          "Scheduled research cycle failed"
        );
      }
    },
    {
      timezone: getTimezone()
    }
  );

  logger.info(
    { job: "research", cron: getSchedule(), timezone: getTimezone() },
    "Research job scheduled"
  );
}

function stopResearchJob() {
  if (!task) {
    return;
  }
  task.stop();
  task = null;
}

module.exports = {
  startResearchJob,
  stopResearchJob
};
