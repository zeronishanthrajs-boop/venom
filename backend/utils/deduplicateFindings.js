const crypto = require("node:crypto");

const SEVERITY_RANK = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

function normalizeText(value) {
  return String(value || "").trim();
}

function toSeverityRank(value) {
  const key = normalizeText(value).toLowerCase();
  return SEVERITY_RANK[key] || 0;
}

function buildFindingFingerprint(finding) {
  const title = normalizeText(finding?.title).toLowerCase();
  const description = normalizeText(finding?.description).toLowerCase();
  return crypto
    .createHash("sha256")
    .update(`${title}::${description}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Deduplicate findings by semantic fingerprint (title + description).
 * Keeps the highest-severity instance and tracks repeat count.
 */
function deduplicateFindings(findings = []) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return [];
  }

  const grouped = new Map();
  for (const finding of findings) {
    const candidate = finding && typeof finding === "object" ? finding : {};
    const key = buildFindingFingerprint(candidate);
    if (!key) {
      continue;
    }

    if (!grouped.has(key)) {
      grouped.set(key, {
        ...candidate,
        count: 1,
        dedupKey: key
      });
      continue;
    }

    const existing = grouped.get(key);
    const nextCount = Number(existing.count || 1) + 1;
    const incomingRank = toSeverityRank(candidate.severity);
    const existingRank = toSeverityRank(existing.severity);

    if (incomingRank > existingRank) {
      grouped.set(key, {
        ...candidate,
        count: nextCount,
        dedupKey: key
      });
    } else {
      existing.count = nextCount;
      grouped.set(key, existing);
    }
  }

  return [...grouped.values()];
}

module.exports = {
  deduplicateFindings
};
