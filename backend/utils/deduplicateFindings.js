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

function parseUrlSafe(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function isBolaFinding(finding = {}) {
  const text = `${normalizeText(finding?.title)} ${normalizeText(
    finding?.type || finding?.metadata?.findingType
  )}`.toLowerCase();
  return text.includes("bola") || text.includes("broken_object_level_authorization");
}

function endpointFromFinding(finding = {}) {
  return (
    normalizeText(finding?.endpoint) ||
    normalizeText(finding?.metadata?.endpoint) ||
    normalizeText(finding?.evidence?.request?.url) ||
    ""
  );
}

function normalizeEndpointForDedup(finding = {}) {
  const endpoint = endpointFromFinding(finding);
  if (!endpoint) {
    return "";
  }
  if (isBolaFinding(finding)) {
    return endpoint;
  }

  const parsed = parseUrlSafe(endpoint);
  const numericParamToken = "{n}";
  if (parsed) {
    const normalizedParams = new URLSearchParams();
    const keys = [...parsed.searchParams.keys()].sort();
    for (const key of keys) {
      normalizedParams.set(key, numericParamToken);
    }
    const query = normalizedParams.toString();
    return `${parsed.pathname || "/"}${query ? `?${query}` : ""}`.toLowerCase();
  }

  const [pathname, rawQuery] = endpoint.split("?");
  if (!rawQuery) {
    return pathname.toLowerCase();
  }
  const params = new URLSearchParams(rawQuery);
  const normalizedParams = new URLSearchParams();
  const keys = [...params.keys()].sort();
  for (const key of keys) {
    normalizedParams.set(key, numericParamToken);
  }
  const query = normalizedParams.toString();
  return `${String(pathname || "/").toLowerCase()}${query ? `?${query}` : ""}`;
}

function toSeverityRank(value) {
  const key = normalizeText(value).toLowerCase();
  return SEVERITY_RANK[key] || 0;
}

function buildFindingFingerprint(finding) {
  const title = normalizeText(finding?.title).toLowerCase();
  const description = normalizeText(finding?.description).toLowerCase();
  const findingType = normalizeText(finding?.type || finding?.metadata?.findingType).toLowerCase();
  const endpoint = normalizeEndpointForDedup(finding);
  return crypto
    .createHash("sha256")
    .update(`${findingType}::${title}::${description}::${endpoint}`)
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
        dedupKey: key,
        observedEndpointVariations: endpointFromFinding(candidate)
          ? [endpointFromFinding(candidate)]
          : []
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
        dedupKey: key,
        observedEndpointVariations: [
          ...new Set([
            ...asArray(existing.observedEndpointVariations),
            endpointFromFinding(candidate)
          ].filter(Boolean))
        ]
      });
    } else {
      existing.count = nextCount;
      existing.observedEndpointVariations = [
        ...new Set([
          ...asArray(existing.observedEndpointVariations),
          endpointFromFinding(candidate)
        ].filter(Boolean))
      ];
      grouped.set(key, existing);
    }
  }

  return [...grouped.values()].map((finding) => {
    const variations = asArray(finding.observedEndpointVariations);
    if (variations.length > 1 && !isBolaFinding(finding)) {
      return {
        ...finding,
        observedAcrossVariations: variations.length,
        deduplicationNote: `Observed across ${variations.length} parameter variations.`
      };
    }
    return finding;
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

module.exports = {
  deduplicateFindings,
  normalizeEndpointForDedup
};
