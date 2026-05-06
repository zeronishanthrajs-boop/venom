const xss = require("xss");

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

module.exports = function inputSanitizer(req, _res, next) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitize(req.body);
  }
  if (req.query && typeof req.query === "object") {
    req.query = sanitize(req.query);
  }
  return next();
};
