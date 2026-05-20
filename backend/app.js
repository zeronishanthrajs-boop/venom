const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const { getDbStatus } = require("./config/db");
const authMiddleware = require("./middleware/auth");
const activityLogger = require("./middleware/activityLogger");
const payloadValidator = require("./middleware/payloadValidator");
const inputSanitizer = require("./middleware/inputSanitizer");
const errorHandler = require("./middleware/errorHandler");
const { apiLimiter } = require("./middleware/rateLimiter");
const { logger } = require("./config/logger");

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
const researchRouter = require("./routes/research");
const evolveRouter = require("./routes/evolve");
const realtimeRouter = require("./routes/realtime");
const decisionsRouter = require("./routes/decisions");
const controlRouter = require("./routes/control");
const monitoringRouter = require("./routes/monitoring");
const adminRouter = require("./routes/admin");
const secretsRouter = require("./routes/secrets");
const supplyChainRouter = require("./routes/supplychain");
const cloudConfigRouter = require("./routes/cloudconfig");
const apiSecurityRouter = require("./routes/apis");
const containerSecurityRouter = require("./routes/container");

function getAllowedOrigins() {
  const csv =
    process.env.ALLOWED_ORIGINS ||
    process.env.CORS_ORIGINS ||
    "http://localhost:3000,http://127.0.0.1:3000";
  return String(csv)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createCorsOptions() {
  const allowedOrigins = new Set(getAllowedOrigins());
  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      logger.warn({ origin }, "CORS rejected origin");
      return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "x-user-id", "x-user-role"],
    optionsSuccessStatus: 204,
    maxAge: 5
  };
}

function applySecurityHeaders(app) {
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    if (
      process.env.NODE_ENV === "production" ||
      req.headers["x-forwarded-proto"] === "https"
    ) {
      res.setHeader(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload"
      );
    }
    next();
  });
}

function getMissingEnvKeys(keys = []) {
  return keys.filter((key) => !String(process.env[key] || "").trim());
}

function buildDependencyDiagnostics() {
  const missingSmtp = getMissingEnvKeys(["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]);
  const geminiConfigured = Boolean(String(process.env.GEMINI_API_KEY || "").trim());
  const geminiPrimaryModel = String(process.env.GEMINI_MODEL || "gemini-2.0-flash").trim();
  const geminiFallbackModels = String(process.env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const chromiumPath = String(process.env.CHROMIUM_PATH || "").trim();
  const chromiumPathProvided = Boolean(chromiumPath);
  const chromiumPathExists = chromiumPathProvided ? fs.existsSync(chromiumPath) : null;

  const warnings = [];
  if (missingSmtp.length > 0) {
    warnings.push(`SMTP missing: ${missingSmtp.join(", ")}`);
  }
  if (!geminiConfigured) {
    warnings.push("GEMINI_API_KEY is not configured");
  }
  if (chromiumPathProvided && chromiumPathExists === false) {
    warnings.push("CHROMIUM_PATH is set but file does not exist");
  }

  return {
    warnings,
    dependencies: {
      smtp: {
        configured: missingSmtp.length === 0,
        missing: missingSmtp
      },
      gemini: {
        configured: geminiConfigured,
        primaryModel: geminiPrimaryModel,
        fallbackModels: geminiFallbackModels
      },
      pdf: {
        chromiumPathProvided,
        chromiumPathExists
      }
    }
  };
}

function createApp() {
  const app = express();
  applySecurityHeaders(app);
  app.use(cors(createCorsOptions()));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: false }));
  app.use(payloadValidator);
  app.use(inputSanitizer);

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
    const diagnostics = buildDependencyDiagnostics();
    if (db.readyState === 1) {
      return res.status(200).json({
        status: "ready",
        db,
        ...diagnostics,
        timestamp: new Date().toISOString()
      });
    }

    return res.status(503).json({
      status: "not_ready",
      db,
      ...diagnostics,
      error:
        "Database is not connected. Configure MONGODB_URI or enable ENABLE_INMEMORY_DB for local development.",
      timestamp: new Date().toISOString()
    });
  });

  app.use("/api", apiLimiter);
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
  app.use("/api/research", authMiddleware, activityLogger, researchRouter);
  app.use("/api/evolve", authMiddleware, activityLogger, evolveRouter);
  app.use("/api/realtime", authMiddleware, activityLogger, realtimeRouter);
  app.use("/api/decisions", authMiddleware, activityLogger, decisionsRouter);
  app.use("/api/control", authMiddleware, activityLogger, controlRouter);
  app.use("/api/monitoring", authMiddleware, activityLogger, monitoringRouter);
  app.use("/api/admin", authMiddleware, activityLogger, adminRouter);
  app.use("/api/secrets", authMiddleware, activityLogger, secretsRouter);
  app.use("/api/supplychain", authMiddleware, activityLogger, supplyChainRouter);
  app.use("/api/cloudconfig", authMiddleware, activityLogger, cloudConfigRouter);
  app.use("/api/apis", authMiddleware, activityLogger, apiSecurityRouter);
  app.use("/api/container", authMiddleware, activityLogger, containerSecurityRouter);

  app.use(errorHandler);
  return app;
}

module.exports = {
  createApp
};
