const crypto = require("node:crypto");

function asString(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const headerKey = String(key || "").trim().toLowerCase();
    if (!headerKey) continue;
    normalized[headerKey] = asString(value);
  }
  return normalized;
}

function extractRedirectLocation(headers = {}) {
  return String(
    headers.location || headers["x-redirect-by"] || headers["x-middleware-rewrite"] || ""
  ).trim();
}

function buildResponseSnapshot(response = {}) {
  const headers = normalizeHeaders(response.headers || {});
  const bodyText = asString(response.body);
  const normalizedBody = bodyText.replace(/\s+/g, " ").trim();
  const bodyHash = crypto
    .createHash("sha1")
    .update(normalizedBody.slice(0, 16000))
    .digest("hex");
  const bodyLength = normalizedBody.length;
  const explicitLength = Number.parseInt(headers["content-length"] || "", 10);

  return {
    statusCode: Number(response.status || 0),
    durationMs: Number(response.durationMs || 0),
    bodyHash,
    bodyLength,
    contentLength: Number.isFinite(explicitLength) ? explicitLength : bodyLength,
    contentType: String(headers["content-type"] || "").toLowerCase(),
    contentEncoding: String(headers["content-encoding"] || "").toLowerCase(),
    cacheControl: String(headers["cache-control"] || "").toLowerCase(),
    vary: String(headers.vary || "").toLowerCase(),
    etag: String(headers.etag || "").trim(),
    retryAfter: String(headers["retry-after"] || "").trim(),
    rateLimitHeaders: {
      limit: String(headers["x-ratelimit-limit"] || headers["ratelimit-limit"] || "").trim(),
      remaining: String(
        headers["x-ratelimit-remaining"] || headers["ratelimit-remaining"] || ""
      ).trim(),
      reset: String(headers["x-ratelimit-reset"] || headers["ratelimit-reset"] || "").trim()
    },
    setCookieCount: Array.isArray(headers["set-cookie"])
      ? headers["set-cookie"].length
      : String(headers["set-cookie"] || "").trim()
        ? 1
        : 0,
    redirectLocation: extractRedirectLocation(headers),
    headers
  };
}

function diffResponseSnapshots(baseline = {}, candidate = {}) {
  const changedHeaders = [];
  const keys = new Set([
    ...Object.keys(baseline.headers || {}),
    ...Object.keys(candidate.headers || {})
  ]);
  for (const key of keys) {
    const baseValue = String(baseline.headers?.[key] || "");
    const nextValue = String(candidate.headers?.[key] || "");
    if (baseValue !== nextValue) {
      changedHeaders.push(key);
    }
  }

  const bodyLengthDelta = Number(candidate.bodyLength || 0) - Number(baseline.bodyLength || 0);
  const durationDelta = Number(candidate.durationMs || 0) - Number(baseline.durationMs || 0);
  const durationChangeRatio =
    Number(baseline.durationMs || 0) > 0
      ? Number(candidate.durationMs || 0) / Number(baseline.durationMs || 1)
      : 1;

  return {
    statusChanged: Number(baseline.statusCode || 0) !== Number(candidate.statusCode || 0),
    bodyChanged: String(baseline.bodyHash || "") !== String(candidate.bodyHash || ""),
    headersChanged: changedHeaders.length > 0,
    changedHeaders,
    bodyLengthDelta,
    durationDeltaMs: durationDelta,
    durationChangeRatio: Number(durationChangeRatio.toFixed(3)),
    retryAfterIntroduced:
      !String(baseline.retryAfter || "").trim() && String(candidate.retryAfter || "").trim() !== "",
    cacheControlChanged:
      String(baseline.cacheControl || "") !== String(candidate.cacheControl || ""),
    redirectChanged:
      String(baseline.redirectLocation || "") !== String(candidate.redirectLocation || ""),
    cookieCountChanged:
      Number(baseline.setCookieCount || 0) !== Number(candidate.setCookieCount || 0)
  };
}

function similarityScore(first = {}, second = {}) {
  const comparisons = [];
  comparisons.push(Number(first.statusCode || 0) === Number(second.statusCode || 0));
  comparisons.push(String(first.bodyHash || "") === String(second.bodyHash || ""));
  comparisons.push(String(first.contentType || "") === String(second.contentType || ""));
  comparisons.push(
    String(first.cacheControl || "").slice(0, 80) ===
      String(second.cacheControl || "").slice(0, 80)
  );
  comparisons.push(String(first.contentEncoding || "") === String(second.contentEncoding || ""));
  comparisons.push(String(first.redirectLocation || "") === String(second.redirectLocation || ""));
  comparisons.push(Number(first.setCookieCount || 0) === Number(second.setCookieCount || 0));
  const lengthDelta = Math.abs(Number(first.bodyLength || 0) - Number(second.bodyLength || 0));
  const maxLength = Math.max(Number(first.bodyLength || 0), Number(second.bodyLength || 1), 1);
  comparisons.push(lengthDelta / maxLength <= 0.05);
  const matches = comparisons.filter(Boolean).length;
  return Number((matches / comparisons.length).toFixed(3));
}

function routeLegitimacyBand(score = 0) {
  if (score >= 80) return "CONFIRMED";
  if (score >= 50) return "PROBABLE";
  if (score >= 20) return "UNCERTAIN";
  return "LIKELY_FAKE";
}

function evaluateGenericResponsePattern(candidate = {}, baselineSnapshots = []) {
  const baselines = Array.isArray(baselineSnapshots) ? baselineSnapshots : [];
  if (baselines.length === 0) {
    return {
      likelyGeneric: false,
      confidence: "MEDIUM",
      reason: "No baseline snapshots available for generic response comparison."
    };
  }

  const scores = baselines.map((snapshot) => similarityScore(snapshot, candidate));
  const maxScore = Math.max(...scores);
  if (maxScore >= 0.95) {
    return {
      likelyGeneric: true,
      confidence: "HIGH",
      similarity: maxScore,
      reason: "Candidate response closely matches generic baseline route responses."
    };
  }
  if (maxScore >= 0.8) {
    return {
      likelyGeneric: true,
      confidence: "MEDIUM",
      similarity: maxScore,
      reason: "Candidate response is similar to baseline fallback pages."
    };
  }
  return {
    likelyGeneric: false,
    confidence: "LOW",
    similarity: maxScore,
    reason: "Candidate response differs from generic baseline responses."
  };
}

module.exports = {
  buildResponseSnapshot,
  diffResponseSnapshots,
  similarityScore,
  routeLegitimacyBand,
  evaluateGenericResponsePattern
};
