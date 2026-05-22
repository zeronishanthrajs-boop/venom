const CONFIDENCE_LEVELS = ["CONFIRMED", "STRONG_SIGNAL", "WEAK_SIGNAL", "INFORMATIONAL"];

const CONFIDENCE_ORDER = {
  CONFIRMED: 4,
  STRONG_SIGNAL: 3,
  WEAK_SIGNAL: 2,
  INFORMATIONAL: 1
};

function normalizeConfidenceLevel(value, fallback = "") {
  const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
  if (CONFIDENCE_LEVELS.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function severityFallbackConfidence(severity = "") {
  const normalized = String(severity || "").trim().toLowerCase();
  if (normalized === "critical") {
    return "CONFIRMED";
  }
  if (normalized === "high") {
    return "STRONG_SIGNAL";
  }
  if (normalized === "medium" || normalized === "low") {
    return "WEAK_SIGNAL";
  }
  return "INFORMATIONAL";
}

function deriveConfidenceLevel(finding = {}) {
  const explicit =
    normalizeConfidenceLevel(finding?.confidence) ||
    normalizeConfidenceLevel(finding?.detectionConfidence) ||
    normalizeConfidenceLevel(finding?.exploitConfidence) ||
    normalizeConfidenceLevel(finding?.metadata?.confidence);
  if (explicit) {
    return explicit;
  }
  return severityFallbackConfidence(finding?.severity);
}

function needsManualValidation(confidence = "") {
  return normalizeConfidenceLevel(confidence) !== "CONFIRMED";
}

function confidenceRank(confidence = "") {
  return CONFIDENCE_ORDER[normalizeConfidenceLevel(confidence, "INFORMATIONAL")] || 0;
}

module.exports = {
  CONFIDENCE_LEVELS,
  normalizeConfidenceLevel,
  deriveConfidenceLevel,
  needsManualValidation,
  confidenceRank
};

