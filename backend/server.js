require("dotenv").config();
const http = require("node:http");

const { connectDB, stopInMemoryServer } = require("./config/db");
const { logger } = require("./config/logger");
const { createApp } = require("./app");
const { startCveSyncJob, stopCveSyncJob } = require("./jobs/cveJob");
const {
  startPromptEvolutionJob,
  stopPromptEvolutionJob
} = require("./jobs/evolutionJob");
const { startResearchJob, stopResearchJob } = require("./jobs/researchJob");
const {
  startMonitoringJob,
  stopMonitoringJob
} = require("./jobs/monitoringJob");
const {
  initWebSocketServer,
  closeWebSocketServer
} = require("./services/realtimeServer");

const app = createApp();
const server = http.createServer(app);
const port = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();
  startCveSyncJob();
  startPromptEvolutionJob();
  startResearchJob();
  startMonitoringJob();
  initWebSocketServer(server);
  server.listen(port, () => {
    logger.info({ port }, "Server started");
  });
}

async function shutdown() {
  try {
    stopCveSyncJob();
    stopPromptEvolutionJob();
    stopResearchJob();
    stopMonitoringJob();
    closeWebSocketServer();
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    await stopInMemoryServer();
  } catch (error) {
    logger.error({ err: error?.message || String(error) }, "Shutdown error");
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

bootstrap().catch((error) => {
  logger.error({ err: error?.message || String(error) }, "Failed to start backend");
  process.exit(1);
});

module.exports = {
  app,
  server,
  bootstrap,
  shutdown
};
