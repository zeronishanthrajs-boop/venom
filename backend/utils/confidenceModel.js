const CONFIDENCE_LEVELS = [
  "CONFIRMED",
  "LIKELY",
  "WEAK",
  "THEORETICAL",
  "UNVERIFIED",
  "CDN_INFLUENCED"
];

const CONFIDENCE_ALIASES = {
  STRONG_SIGNAL: "LIKELY",
  WEAK_SIGNAL: "WEAK",
  INFORMATIONAL: "THEORETICAL",
  POSSIBLE: "THEORETICAL",
  PROBABLE: "LIKELY"
};

const CONFIDENCE_ORDER = {
  CONFIRMED: 6,
  LIKELY: 5,
  WEAK: 4,
  CDN_INFLUENCED: 3,
  THEORETICAL: 2,
  UNVERIFIED: 1
};

function normalizeConfidenceLevel(value, fallback = "") {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
  const canonical = CONFIDENCE_ALIASES[normalized] || normalized;
  if (CONFIDENCE_LEVELS.includes(canonical)) {
    return canonical;
  }
  return fallback;
}

function severityFallbackConfidence(severity = "") {
  const normalized = String(severity || "").trim().toLowerCase();
  if (normalized === "critical" || normalized === "high") {
    return "LIKELY";
  }
  if (normalized === "medium") {
    return "WEAK";
  }
  if (normalized === "low") {
    return "THEORETICAL";
  }
  return "UNVERIFIED";
}

function deriveConfidenceLevel(finding = {}) {
  const explicit =
    normalizeConfidenceLevel(finding?.confidence) ||
    normalizeConfidenceLevel(finding?.detectionConfidence) ||
    normalizeConfidenceLevel(finding?.exploitConfidence) ||
    normalizeConfidenceLevel(finding?.evidenceStrength) ||
    normalizeConfidenceLevel(finding?.metadata?.confidence) ||
    normalizeConfidenceLevel(finding?.metadata?.evidenceStrength);
  if (explicit) {
    return explicit;
  }

  if (finding?.metadata?.cdnInfluenced === true) {
    return "CDN_INFLUENCED";
  }
  return severityFallbackConfidence(finding?.severity);
}

function deriveVerificationMode(finding = {}) {
  const explicitMode =
    String(finding?.verificationMode || finding?.metadata?.verificationMode || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");
  const supportedModes = new Set([
    "OBSERVED",
    "INFERRED",
    "CONFIRMED",
    "EXPLOITED",
    "PARTIALLY_VALIDATED"
  ]);
  if (supportedModes.has(explicitMode)) {
    return explicitMode;
  }

  const confidence = deriveConfidenceLevel(finding);
  if (finding?.metadata?.exploited === true) {
    return "EXPLOITED";
  }
  if (confidence === "CONFIRMED") {
    return "CONFIRMED";
  }
  if (confidence === "LIKELY") {
    return "PARTIALLY_VALIDATED";
  }
  if (confidence === "WEAK" || confidence === "CDN_INFLUENCED") {
    return "OBSERVED";
  }
  return "INFERRED";
}

function needsManualValidation(confidence = "") {
  return normalizeConfidenceLevel(confidence) !== "CONFIRMED";
}

function confidenceRank(confidence = "") {
  return CONFIDENCE_ORDER[normalizeConfidenceLevel(confidence, "UNVERIFIED")] || 0;
}

module.exports = {
  CONFIDENCE_LEVELS,
  normalizeConfidenceLevel,
  deriveConfidenceLevel,
  deriveVerificationMode,
  needsManualValidation,
  confidenceRank
};
