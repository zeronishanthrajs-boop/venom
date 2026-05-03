function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPatternRegExp(pattern) {
  return new RegExp(
    `^${escapeRegExp(pattern.toLowerCase()).replace(/\\\*/g, ".*")}$`
  );
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === "string" && item.trim() !== "");
}

function matchesAnyDomain(hostname, allowedDomains) {
  if (allowedDomains.length === 0) {
    return true;
  }

  return allowedDomains.some((domainPattern) =>
    toPatternRegExp(domainPattern).test(hostname.toLowerCase())
  );
}

module.exports = function engagementConstraints(req, res, next) {
  const { targetUrl, scope = {}, authorization = {} } = req.body;

  if (!targetUrl || typeof targetUrl !== "string") {
    return res.status(400).json({
      error: "targetUrl is required"
    });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (_error) {
    return res.status(400).json({
      error: "targetUrl must be a valid URL"
    });
  }

  const allowedDomains = normalizeStringArray(scope.allowedDomains);
  const restrictedPaths = normalizeStringArray(scope.restrictedPaths);

  if (!matchesAnyDomain(parsedUrl.hostname, allowedDomains)) {
    return res.status(403).json({
      error: `Target domain ${parsedUrl.hostname} is not in allowedDomains`
    });
  }

  const blockedPath = restrictedPaths.find((restrictedPath) =>
    parsedUrl.pathname.startsWith(restrictedPath)
  );
  if (blockedPath) {
    return res.status(403).json({
      error: `Target path ${parsedUrl.pathname} is restricted by ${blockedPath}`
    });
  }

  if (authorization.validUntil) {
    const validUntil = new Date(authorization.validUntil);
    if (Number.isNaN(validUntil.getTime())) {
      return res.status(400).json({
        error: "authorization.validUntil must be a valid date"
      });
    }

    if (validUntil < new Date()) {
      return res.status(403).json({
        error: "Engagement authorization has expired"
      });
    }
  }

  next();
};
