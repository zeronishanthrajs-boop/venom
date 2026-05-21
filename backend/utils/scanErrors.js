function asErrorString(error) {
  if (!error) {
    return "Unknown error";
  }
  if (error instanceof Error) {
    return error.stack || error.message || String(error);
  }
  return String(error);
}

function errorMessage(error, fallback = "Scan failed") {
  return String(error?.message || error || fallback);
}

function classifyError(error) {
  if (error?.errorCode) {
    return String(error.errorCode).toUpperCase();
  }
  const code = String(error?.code || "").toUpperCase();
  const message = errorMessage(error, "Scan failed");
  const normalized = message.toLowerCase();

  if (
    code === "TOOL_NOT_INSTALLED" ||
    code === "ENOENT" ||
    normalized.includes("not found") ||
    normalized.includes("not recognized")
  ) {
    return "TOOL_NOT_INSTALLED";
  }
  if (
    code === "TOOL_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return "NETWORK_TIMEOUT";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || normalized.includes("getaddrinfo")) {
    return "DNS_RESOLUTION_FAILED";
  }
  if (code === "ECONNREFUSED" || normalized.includes("connection refused")) {
    return "CONNECTION_REFUSED";
  }
  if (code === "EACCES" || code === "EPERM" || normalized.includes("permission denied")) {
    return "PERMISSION_DENIED";
  }
  if (code === "DOCKER_DISABLED") {
    return "TOOL_NOT_INSTALLED";
  }
  if (code === "SUBPROCESS_SPAWN_ERROR") {
    return "SUBPROCESS_SPAWN_ERROR";
  }
  return code || "UNKNOWN_ERROR";
}

function buildFailureReason(errorCode, message) {
  return `${errorCode}: ${message}`;
}

function createStructuredError(error, fallback = {}) {
  const errorCode = fallback.errorCode || classifyError(error);
  const message = fallback.message || errorMessage(error, "Scan failed");
  return {
    status: "ERROR",
    errorCode,
    message,
    raw: asErrorString(error),
    failureReason: buildFailureReason(errorCode, message)
  };
}

function createToolNotInstalledResult({ toolName, toolId, purpose, installHint }) {
  const displayName = toolName || toolId || "tool";
  const message = `${displayName} not found on system PATH. ${purpose || "The scan was skipped because the required scanner is unavailable."}${installHint ? ` ${installHint}` : ""}`;
  return {
    status: "TOOL_NOT_INSTALLED",
    errorCode: "TOOL_NOT_INSTALLED",
    message,
    raw: message,
    failureReason: buildFailureReason("TOOL_NOT_INSTALLED", message),
    findings: []
  };
}

function createNotApplicableResult({ reason, requiredTarget = "a GitHub repository URL", note }) {
  const message =
    reason ||
    `Source code analysis requires ${requiredTarget}. This scan was intentionally skipped.`;
  return {
    status: "NOT_APPLICABLE",
    reason: message,
    requiredTarget,
    note: note || "The scan was intentionally skipped rather than failing.",
    findings: [],
    failureReason: buildFailureReason("NOT_APPLICABLE", message)
  };
}

function logError(logger, context, message, error) {
  if (!logger || typeof logger.error !== "function") {
    return;
  }
  logger.error(
    {
      ...(context || {}),
      error: errorMessage(error, "Unknown error"),
      stack: error?.stack || ""
    },
    message
  );
}

function logWarn(logger, context, message, error) {
  if (!logger || typeof logger.warn !== "function") {
    return;
  }
  logger.warn(
    {
      ...(context || {}),
      error: errorMessage(error, "Unknown error"),
      stack: error?.stack || ""
    },
    message
  );
}

module.exports = {
  asErrorString,
  buildFailureReason,
  classifyError,
  createNotApplicableResult,
  createStructuredError,
  createToolNotInstalledResult,
  errorMessage,
  logError,
  logWarn
};
