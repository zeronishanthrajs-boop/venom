const cron = require("node-cron");
const { runResearchCycle } = require("../services/researchEngine");

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
    console.log("[ResearchJob] Disabled (ENABLE_RESEARCH_JOB != true).");
    return;
  }

  if (task) {
    return;
  }

  task = cron.schedule(
    getSchedule(),
    async () => {
      try {
        console.log("[ResearchJob] Starting scheduled research cycle...");
        await runResearchCycle({
          trigger: "cron",
          createdBy: "research-job"
        });
      } catch (error) {
        console.error("[ResearchJob] Failed:", error.message);
      }
    },
    {
      timezone: getTimezone()
    }
  );

  console.log(
    `[ResearchJob] Scheduled (${getSchedule()}) timezone=${getTimezone()}`
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

