const { logger } = require("../config/logger");

const SAFE_ERROR_MESSAGES = {
  ValidationError: "Invalid request format",
  MongoError: "Database unavailable",
  MongoServerError: "Database unavailable",
  UnauthorizedError: "Unauthorized access"
};

function sanitizeError(error) {
  const rawMessage = error?.message || "Internal server error";
  const isKnownIssue =
    typeof rawMessage === "string" &&
    (rawMessage.startsWith("ISSUE-REPORT") || rawMessage.startsWith("ISSUE-BACKEND") ||
      rawMessage.includes("PDF generation") || rawMessage.includes("Server auth misconfigured"));

  if (process.env.NODE_ENV === "production") {
    if (isKnownIssue) {
      return rawMessage;
    }
    return SAFE_ERROR_MESSAGES[error?.constructor?.name] || "Internal server error";
  }
  return rawMessage;
}

module.exports = function errorHandler(error, _req, res, _next) {
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

  if (error?.message === "Origin not allowed by CORS") {
    return res.status(403).json({
      error: "CORS denied"
    });
  }

  logger.error(
    {
      errName: error?.name || "Error",
      errMessage: error?.message || "Unknown error"
    },
    "Unhandled API error"
  );

  const statusCode =
    Number.isFinite(error?.httpStatus) && error.httpStatus >= 400
      ? Number(error.httpStatus)
      : 500;

  return res.status(statusCode).json({
    error: sanitizeError(error)
  });
};
