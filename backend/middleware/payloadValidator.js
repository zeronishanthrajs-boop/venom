const MAX_BODY_BYTES = Number.parseInt(process.env.MAX_BODY_BYTES || "10485760", 10);

function hasBody(method) {
  return ["POST", "PUT", "PATCH"].includes(String(method || "").toUpperCase());
}

function containsDangerousMongoOperators(value) {
  if (Array.isArray(value)) {
    return value.some((item) => containsDangerousMongoOperators(item));
  }
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (key.startsWith("$") || key.includes(".")) {
        return true;
      }
      if (containsDangerousMongoOperators(inner)) {
        return true;
      }
    }
  }
  return false;
}

module.exports = function payloadValidator(req, res, next) {
  if (!hasBody(req.method)) {
    return next();
  }

  const hasAuthHeaders =
    Boolean(req.headers["x-api-key"]) &&
    Boolean(req.headers["x-user-id"]) &&
    Boolean(req.headers["x-user-role"]);
  if (!hasAuthHeaders) {
    return next();
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const contentLengthHeader = req.headers["content-length"];
  const contentLength = Number.parseInt(String(contentLengthHeader || "0"), 10);
  const transferEncoding = String(req.headers["transfer-encoding"] || "").trim();
  const hasPayload =
    (Number.isFinite(contentLength) && contentLength > 0) ||
    transferEncoding.length > 0;

  if (hasPayload && !contentType.includes("application/json")) {
    return res.status(415).json({
      error: "Unsupported Media Type. Use application/json."
    });
  }

  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({
      error: "Payload Too Large"
    });
  }

  if (containsDangerousMongoOperators(req.body)) {
    return res.status(400).json({
      error: "Invalid payload keys"
    });
  }

  return next();
};
