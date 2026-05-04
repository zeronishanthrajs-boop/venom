require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { connectDB, getDbStatus, stopInMemoryServer } = require("./config/db");
const authMiddleware = require("./middleware/auth");
const activityLogger = require("./middleware/activityLogger");
const engagementsRouter = require("./routes/engagements");
const patternsRouter = require("./routes/patterns");
const planRouter = require("./routes/plan");
const executeRouter = require("./routes/execute");
const learnRouter = require("./routes/learn");
const metricsRouter = require("./routes/metrics");
const cvesRouter = require("./routes/cves");
const reportsRouter = require("./routes/reports");
const complianceRouter = require("./routes/compliance");
const chainRouter = require("./routes/chain");
const evidenceRouter = require("./routes/evidence");
const promptsRouter = require("./routes/prompts");
const orchestrateRouter = require("./routes/orchestrate");
const { startCveSyncJob, stopCveSyncJob } = require("./jobs/cveJob");
const {
  startPromptEvolutionJob,
  stopPromptEvolutionJob
} = require("./jobs/evolutionJob");

const app = express();
const port = process.env.PORT || 5000;
const allowedOrigins = (process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://127.0.0.1:3000").split(",");
const normalizedAllowedOrigins = allowedOrigins
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || normalizedAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key", "x-user-id", "x-user-role"],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.get("/health", (_req, res) => {
  const db = getDbStatus();
  res.status(200).json({
    status: "up",
    service: "venom-backend",
    db,
    timestamp: new Date().toISOString()
  });
});

app.get("/ready", (_req, res) => {
  const db = getDbStatus();
  if (db.readyState === 1) {
    return res.status(200).json({
      status: "ready",
      db,
      timestamp: new Date().toISOString()
    });
  }

  return res.status(503).json({
    status: "not_ready",
    db,
    error:
      "Database is not connected. Configure MONGODB_URI or enable ENABLE_INMEMORY_DB for local development.",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/engagements", authMiddleware, activityLogger, engagementsRouter);
app.use("/api/patterns", authMiddleware, activityLogger, patternsRouter);
app.use("/api/plan", authMiddleware, activityLogger, planRouter);
app.use("/api/execute", authMiddleware, activityLogger, executeRouter);
app.use("/api/learn", authMiddleware, activityLogger, learnRouter);
app.use("/api/metrics", authMiddleware, activityLogger, metricsRouter);
app.use("/api/cves", authMiddleware, activityLogger, cvesRouter);
app.use("/api/cve", authMiddleware, activityLogger, cvesRouter);
app.use("/api/reports", authMiddleware, activityLogger, reportsRouter);
app.use("/api/compliance", authMiddleware, activityLogger, complianceRouter);
app.use("/api/chain", authMiddleware, activityLogger, chainRouter);
app.use("/api/evidence", authMiddleware, activityLogger, evidenceRouter);
app.use("/api/prompts", authMiddleware, activityLogger, promptsRouter);
app.use("/api/orchestrate", authMiddleware, activityLogger, orchestrateRouter);

app.use((error, _req, res, _next) => {
  const isJsonParseError =
    error?.type === "entity.parse.failed" ||
    (error?.name === "SyntaxError" && error?.status === 400) ||
    (error?.statusCode === 400 &&
      typeof error?.message === "string" &&
      /json/i.test(error.message));

  if (isJsonParseError) {
    return res.status(400).json({
      error: "Invalid JSON body"
    });
  }

  console.error("Unhandled API error:", error);
  res.status(500).json({
    error: "Internal server error"
  });
});

async function bootstrap() {
  await connectDB();
  startCveSyncJob();
  startPromptEvolutionJob();
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

async function shutdown() {
  try {
    stopCveSyncJob();
    stopPromptEvolutionJob();
    await stopInMemoryServer();
  } catch (error) {
    console.error("Error during in-memory DB shutdown:", error.message);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

bootstrap().catch((error) => {
  console.error("Failed to start backend:", error.message);
  process.exit(1);
});
