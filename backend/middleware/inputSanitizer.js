const xss = require("xss");

const DEFAULT_RAW_BODY_ROUTE_PREFIXES = [
  "/api/patterns",
  "/api/prompts",
  "/api/evolve/prompts"
];

function sanitize(value) {
  if (typeof value === "string") {
    return xss(value, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ["script", "style"]
    }).trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (value && typeof value === "object") {
    const next = {};
    for (const [key, inner] of Object.entries(value)) {
      next[key] = sanitize(inner);
    }
    return next;
  }

  return value;
}

function getRawBodyBypassRoutePrefixes() {
  const configured = String(process.env.SANITIZER_RAW_BODY_BYPASS_ROUTES || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith("/") ? item : `/${item}`));
  if (configured.length > 0) {
    return configured;
  }
  return DEFAULT_RAW_BODY_ROUTE_PREFIXES;
}

function normalizeRequestPath(req) {
  const raw = String(req.originalUrl || req.path || "")
    .split("?")[0]
    .trim()
    .toLowerCase();
  if (!raw) {
    return "/";
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function shouldBypassBodySanitizer(req) {
  const requestPath = normalizeRequestPath(req);
  return getRawBodyBypassRoutePrefixes().some(
    (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
  );
}

function inputSanitizer(req, _res, next) {
  if (
    req.body &&
    typeof req.body === "object" &&
    !shouldBypassBodySanitizer(req)
  ) {
    req.body = sanitize(req.body);
  }
  if (req.query && typeof req.query === "object") {
    req.query = sanitize(req.query);
  }
  return next();
}

module.exports = inputSanitizer;
module.exports.__internal = {
  sanitize,
  shouldBypassBodySanitizer,
  getRawBodyBypassRoutePrefixes
};
