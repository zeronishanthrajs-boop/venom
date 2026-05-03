function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeSuccessRate(successCount, failureCount) {
  const total = successCount + failureCount;
  if (total <= 0) {
    return 0;
  }
  return Number((successCount / total).toFixed(4));
}

function appendRecentOutcomes(existingOutcomes, newOutcomes, limit = 20) {
  const merged = [...(existingOutcomes || []), ...(newOutcomes || [])]
    .map((item) => Boolean(item))
    .slice(-limit);
  return merged;
}

function computeRecentSuccessRate(recentOutcomes) {
  if (!Array.isArray(recentOutcomes) || recentOutcomes.length === 0) {
    return 0;
  }
  const success = recentOutcomes.filter(Boolean).length;
  return Number((success / recentOutcomes.length).toFixed(4));
}

function computeConfidence(successRate, recentSuccessRate, sampleSize) {
  const sampleBoost = clamp(sampleSize / 20, 0, 1);
  const blended = successRate * 0.65 + recentSuccessRate * 0.35;
  return Number((blended * (0.5 + 0.5 * sampleBoost)).toFixed(4));
}

function typeMatchScore(patternTargetType, engagementTargetType) {
  if (patternTargetType === engagementTargetType) {
    return 1;
  }
  if (patternTargetType === "mixed") {
    return 0.8;
  }
  return 0.35;
}

function versionCoverageScore(pattern, engagement) {
  const url = engagement.targetUrl || "";
  const targetType = engagement.targetType || "";
  const tags = Array.isArray(pattern.tags)
    ? pattern.tags.map((tag) => tag.toLowerCase())
    : [];

  const hostHint = url.toLowerCase();
  const tagHit = tags.some(
    (tag) => hostHint.includes(tag) || tag.includes(targetType)
  );
  return tagHit ? 0.85 : 0.55;
}

function crossTargetGeneralizationScore(pattern) {
  if (typeof pattern.generalizationScore === "number") {
    return clamp(pattern.generalizationScore, 0, 1);
  }
  return pattern.targetType === "mixed" ? 0.8 : 0.5;
}

function scorePatternForEngagement(pattern, engagement) {
  const targetMatch = typeMatchScore(pattern.targetType, engagement.targetType);
  const coverage = versionCoverageScore(pattern, engagement);
  const recentRate =
    typeof pattern.recentSuccessRate === "number"
      ? pattern.recentSuccessRate
      : pattern.successRate || 0;
  const generalization = crossTargetGeneralizationScore(pattern);

  const score =
    targetMatch * 0.4 + coverage * 0.3 + recentRate * 0.2 + generalization * 0.1;

  const reason = `type_match=${targetMatch.toFixed(
    2
  )}, coverage=${coverage.toFixed(2)}, recent=${recentRate.toFixed(
    2
  )}, generalization=${generalization.toFixed(2)}`;

  return {
    patternId: pattern._id,
    patternName: pattern.name,
    targetType: pattern.targetType,
    applicabilityScore: Number(score.toFixed(4)),
    confidence:
      typeof pattern.confidence === "number" ? pattern.confidence : 0,
    successRate:
      typeof pattern.successRate === "number" ? pattern.successRate : 0,
    recentSuccessRate: recentRate,
    reason
  };
}

module.exports = {
  computeSuccessRate,
  appendRecentOutcomes,
  computeRecentSuccessRate,
  computeConfidence,
  scorePatternForEngagement
};
