const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { logger } = require("./logger");

let memoryServer = null;
let connectionSource = "none";

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toConnectionStateLabel(state) {
  switch (state) {
    case 0:
      return "disconnected";
    case 1:
      return "connected";
    case 2:
      return "connecting";
    case 3:
      return "disconnecting";
    default:
      return "unknown";
  }
}

function getDbStatus() {
  return {
    readyState: mongoose.connection.readyState,
    state: toConnectionStateLabel(mongoose.connection.readyState),
    source: connectionSource,
    usingInMemory: connectionSource === "in-memory"
  };
}

async function stopInMemoryServer() {
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
    connectionSource = "none";
  }
}

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  const inMemoryByDefault = process.env.NODE_ENV !== "production";
  const enableInMemoryDb =
    process.env.ENABLE_INMEMORY_DB === "true" ||
    (process.env.ENABLE_INMEMORY_DB === undefined && inMemoryByDefault);

  mongoose.set("strictQuery", true);

  if (uri) {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: toPositiveInteger(
        process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
        5000
      ),
      socketTimeoutMS: toPositiveInteger(
        process.env.MONGODB_SOCKET_TIMEOUT_MS,
        45000
      ),
      connectTimeoutMS: toPositiveInteger(
        process.env.MONGODB_CONNECT_TIMEOUT_MS,
        10000
      )
    });
    connectionSource = "external-uri";
    logger.info({ source: "external-uri" }, "MongoDB connected");
    return;
  }

  if (!enableInMemoryDb) {
    logger.warn(
      "MONGODB_URI not set and ENABLE_INMEMORY_DB is disabled. Starting without database connection."
    );
    return;
  }

  const memoryLaunchTimeout = toPositiveInteger(
    process.env.MONGOMS_LAUNCH_TIMEOUT_MS,
    30000
  );
  const memoryServerOptions = {
    instance: {
      dbName: process.env.INMEMORY_DB_NAME || "venom_dev",
      launchTimeout: memoryLaunchTimeout
    }
  };

  if (process.env.MONGOMS_BINARY_VERSION) {
    memoryServerOptions.binary = {
      version: process.env.MONGOMS_BINARY_VERSION
    };
  }

  memoryServer = await MongoMemoryServer.create(memoryServerOptions);
  const memoryUri = memoryServer.getUri();
  await mongoose.connect(memoryUri);
  connectionSource = "in-memory";
  logger.info({ source: "in-memory" }, "MongoDB connected");
}

module.exports = {
  connectDB,
  getDbStatus,
  stopInMemoryServer
};
