const ScoreHistory = require("../models/ScoreHistory");
const { logger } = require("../config/logger");

const DEDUCTION_RULES = {
  confirmedCritical: { amount: 25, cap: 75, label: "Confirmed Critical exploit" },
  confirmedHigh: { amount: 15, cap: 45, label: "Confirmed High finding" },
  suspectedHigh: { amount: 8, cap: 32, label: "Suspected High finding" },
  confirmedMedium: { amount: 5, cap: 20, label: "Confirmed Medium finding" },
  suspectedMedium: { amount: 2, cap: 10, label: "Suspected Medium finding" },
  low: { amount: 1, cap: 5, label: "Low finding" },
  missingHeader: { amount: 2, cap: 16, label: "Missing security header" }
};

const POSITIVE_SIGNAL_BONUSES = [
  ["allSecurityHeadersPresent", 5, "All 11 security headers present and correctly configured"],
  ["httpsHstsValid", 3, "HTTPS + valid cert + strong HSTS confirmed"],
  ["wafActiveOnAuthEndpoints", 4, "WAF detected and active on auth endpoints"],
  ["rateLimitingOnAuthEndpoints", 3, "Rate limiting confirmed on auth endpoints"],
  ["strictCsp", 3, "CSP present without unsafe-inline or unsafe-eval"],
  ["sriOnExternalScripts", 2, "Subresource Integrity present on external scripts"]
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["critical", "high", "medium", "low", "info"].includes(normalized)) {
    return normalized;
  }
  return "low";
}

function findingText(finding = {}) {
  return [
    finding.type,
    finding.title,
    finding.description,
    finding.category,
    finding.rootCauseId,
    finding.rootCauseLabel,
    finding.metadata?.findingType,
    finding.metadata?.vulnerabilityClass
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isConfirmed(finding = {}) {
  const text = [
    finding.confirmed,
    finding.exploitValidated,
    finding.validationStatus,
    finding.verificationMode,
    finding.evidenceStrength,
    finding.confidence,
    finding.metadata?.confirmed,
    finding.metadata?.exploitValidated,
    finding.metadata?.validationStatus,
    finding.metadata?.verificationMode,
    finding.metadata?.evidenceStrength
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toUpperCase();
  return (
    finding.confirmed === true ||
    finding.exploitValidated === true ||
    finding.metadata?.confirmed === true ||
    finding.metadata?.exploitValidated === true ||
    /CONFIRMED|EXPLOITED|VALIDATED/.test(text)
  );
}

function isMissingHeaderFinding(finding = {}) {
  return /missing security header|missing header|content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|cross-origin|cookie security/.test(
    findingText(finding)
  );
}

function classifyDeductionBucket(finding = {}) {
  if (isMissingHeaderFinding(finding)) return "missingHeader";
  const severity = normalizeSeverity(finding.severity || finding.metadata?.severity);
  const confirmed = isConfirmed(finding);
  if (severity === "critical" && confirmed) return "confirmedCritical";
  if (severity === "critical") return "confirmedHigh";
  if (severity === "high" && confirmed) return "confirmedHigh";
  if (severity === "high") return "suspectedHigh";
  if (severity === "medium" && confirmed) return "confirmedMedium";
  if (severity === "medium") return "suspectedMedium";
  if (severity === "low") return "low";
  return null;
}

function buildFindingReason(finding = {}, rule = {}) {
  const type = finding.rootCauseId || finding.type || finding.metadata?.findingType || "SECURITY_FINDING";
  const detail = finding.rootCauseLabel || finding.title || "finding";
  return `${rule.label}: ${type} (${detail})`;
}

function applyCappedDeduction(runningTotals, bucket, finding) {
  const rule = DEDUCTION_RULES[bucket];
  if (!rule) return null;
  const alreadyApplied = Number(runningTotals[bucket] || 0);
  const remaining = Math.max(0, rule.cap - alreadyApplied);
  const amount = Math.min(rule.amount, remaining);
  if (amount <= 0) {
    return null;
  }
  runningTotals[bucket] = alreadyApplied + amount;
  return {
    reason: buildFindingReason(finding, rule),
    amount: -amount,
    bucket,
    findingId: finding.id || finding._id || null
  };
}

function positiveSignalsFromContext(context = {}) {
  const signals = {
    ...(context.positiveSignals || {})
  };

  const headerScore = Number(context.headerSecuritySubScore);
  if (Number.isFinite(headerScore) && headerScore >= 95) {
    signals.allSecurityHeadersPresent = true;
  }

  return signals;
}

function calculateFindingEps(finding = {}, context = {}) {
  const endpointConfirmed =
    finding.endpointStatus === "CONFIRMED_PRESENT" ||
    finding.metadata?.endpointStatus === "CONFIRMED_PRESENT" ||
    finding.metadata?.endpointExistenceConfidence === "HIGH";
  const exploitValidated = isConfirmed(finding);
  const wafAbsent =
    finding.wafProtected === false &&
    finding.metadata?.wafProtected !== true &&
    context.wafDetected !== true;
  const authNotRequired =
    finding.authRequired === false ||
    finding.metadata?.requiresAuth === false ||
    finding.authProtected === false ||
    finding.metadata?.authProtected === false;
  const rateLimitingAbsent =
    finding.rateLimitingAbsent === true ||
    finding.metadata?.rateLimitingAbsent === true ||
    /rate.?limit|throttl/.test(findingText(finding));
  const matchingCve =
    Boolean(finding.cve || finding.cveId || finding.metadata?.cve || finding.metadata?.cveId) ||
    finding.metadata?.matchingCveExists === true;

  let score = 0;
  const factors = [];
  if (endpointConfirmed) {
    score += 20;
    factors.push("endpoint confirmed present +20");
  }
  if (exploitValidated) {
    score += 40;
    factors.push("exploit validated +40");
  }
  if (wafAbsent) {
    score += 10;
    factors.push("WAF absent +10");
  }
  if (authNotRequired) {
    score += 10;
    factors.push("authentication not required +10");
  }
  if (rateLimitingAbsent) {
    score += 5;
    factors.push("rate limiting absent +5");
  }
  if (matchingCve) {
    score += 15;
    factors.push("matching CVE exists +15");
  }

  const capped = !exploitValidated ? Math.min(score, 45) : score;
  return {
    score: clamp(capped, 0, 100),
    uncappedScore: clamp(score, 0, 100),
    capped: !exploitValidated && score > 45,
    factors
  };
}

function floorForFindings(findings = []) {
  const floors = [];
  for (const finding of findings) {
    if (!isConfirmed(finding)) continue;
    const text = findingText(finding);
    if (/remote code execution|\brce\b|command execution/.test(text)) {
      floors.push({ reason: "Confirmed RCE present", maxScore: 10 });
    }
    if (/sql.?injection|\bsqli\b/.test(text)) {
      floors.push({ reason: "Confirmed SQLi present", maxScore: 25 });
    }
    if (/auth bypass|authentication bypass|mfa_bypass|bypass confirmed/.test(text)) {
      floors.push({ reason: "Confirmed auth bypass present", maxScore: 20 });
    }
    if (/\bssrf\b|server-side request forgery/.test(text)) {
      floors.push({ reason: "Confirmed SSRF present", maxScore: 30 });
    }
    if (/stored xss|persistent xss/.test(text)) {
      floors.push({ reason: "Confirmed stored XSS present", maxScore: 35 });
    }
  }
  return floors;
}

function riskRatingFromScore(score) {
  if (score <= 35) return "HIGH";
  if (score <= 65) return "MEDIUM";
  return "LOW";
}

function calculateSecurityScore(findings = [], context = {}) {
  const deductions = [];
  const bonuses = [];
  const cappedTotals = {};
  const normalizedFindings = Array.isArray(findings) ? findings : [];
  const epsByFinding = normalizedFindings.map((finding) => ({
    findingId: finding.id || finding._id || null,
    title: finding.title || finding.type || "Finding",
    eps: calculateFindingEps(finding, context)
  }));

  for (const finding of normalizedFindings) {
    const bucket = classifyDeductionBucket(finding);
    const deduction = applyCappedDeduction(cappedTotals, bucket, finding);
    if (deduction) deductions.push(deduction);
  }

  const signals = positiveSignalsFromContext(context);
  for (const [key, amount, reason] of POSITIVE_SIGNAL_BONUSES) {
    if (signals[key]) {
      bonuses.push({ reason, amount });
    }
  }

  const baseScore = 100;
  const totalDeductions = deductions.reduce((sum, item) => sum + item.amount, 0);
  const totalBonuses = bonuses.reduce((sum, item) => sum + item.amount, 0);
  const beforeFloors = clamp(baseScore + totalDeductions + totalBonuses, 0, 100);
  const possibleFloors = floorForFindings(normalizedFindings);
  const floorsApplied = [];
  let finalScore = beforeFloors;
  for (const floor of possibleFloors) {
    if (finalScore > floor.maxScore) {
      finalScore = floor.maxScore;
      floorsApplied.push(floor);
    }
  }
  finalScore = clamp(Math.round(finalScore), 0, 100);
  const calculationAudit = `Base ${baseScore} ${totalDeductions < 0 ? "-" : "+"} ${Math.abs(totalDeductions)} (deductions) + ${totalBonuses} (bonuses) = ${Math.round(beforeFloors)}. ${
    floorsApplied.length > 0
      ? `Floors applied: ${floorsApplied.map((floor) => `${floor.reason} <= ${floor.maxScore}`).join("; ")}. Final score ${finalScore}.`
      : "No floors triggered."
  }`;

  return {
    finalScore,
    score: finalScore,
    maxScore: 100,
    baseScore,
    deductions,
    bonuses,
    floorsApplied,
    totalDeductions,
    totalBonuses,
    calculationAudit,
    epsByFinding,
    riskRating: riskRatingFromScore(finalScore),
    formula: {
      startsAt: baseScore,
      deductions,
      bonuses,
      floorsApplied,
      totalDeductions,
      totalBonuses,
      calculationAudit
    }
  };
}

function domainFromTarget(targetUrl = "") {
  try {
    return new URL(String(targetUrl || "")).hostname;
  } catch {
    return String(targetUrl || "unknown").trim() || "unknown";
  }
}

async function recordScoreHistory({ engagementId, targetUrl, findings = [], context = {} } = {}) {
  if (!engagementId) {
    return null;
  }
  const breakdown = calculateSecurityScore(findings, context);
  try {
    const record = await ScoreHistory.create({
      engagementId,
      domain: domainFromTarget(targetUrl || context.targetUrl),
      score: breakdown.finalScore,
      breakdown,
      timestamp: new Date()
    });
    return record.toObject();
  } catch (error) {
    logger.warn(
      { engagementId, error: error?.message || String(error) },
      "Score history persistence failed"
    );
    return null;
  }
}

module.exports = {
  calculateSecurityScore,
  calculateFindingEps,
  recordScoreHistory,
  domainFromTarget
};
