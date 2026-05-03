const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeSuccessRate,
  appendRecentOutcomes,
  computeRecentSuccessRate,
  computeConfidence,
  scorePatternForEngagement
} = require("../services/patternEngine");

test("computeSuccessRate returns 0 for empty totals", () => {
  assert.equal(computeSuccessRate(0, 0), 0);
});

test("computeSuccessRate returns rounded proportion", () => {
  assert.equal(computeSuccessRate(7, 3), 0.7);
});

test("appendRecentOutcomes keeps only most recent 20 entries", () => {
  const base = Array.from({ length: 18 }, (_, i) => i % 2 === 0);
  const merged = appendRecentOutcomes(base, [true, false, true, false, true]);
  assert.equal(merged.length, 20);
  assert.deepEqual(merged.slice(-3), [true, false, true]);
});

test("computeRecentSuccessRate calculates from boolean outcomes", () => {
  assert.equal(computeRecentSuccessRate([true, true, false, false]), 0.5);
});

test("computeConfidence stays within 0-1 and increases with better rates", () => {
  const low = computeConfidence(0.2, 0.2, 2);
  const high = computeConfidence(0.8, 0.9, 20);
  assert.ok(low >= 0 && low <= 1);
  assert.ok(high >= 0 && high <= 1);
  assert.ok(high > low);
});

test("scorePatternForEngagement returns expected shape and bounded score", () => {
  const pattern = {
    _id: "p1",
    name: "baseline_http_headers_probe",
    targetType: "website",
    successRate: 0.75,
    recentSuccessRate: 0.8,
    confidence: 0.74,
    generalizationScore: 0.6,
    tags: ["website", "headers"]
  };
  const engagement = {
    targetType: "website",
    targetUrl: "https://example.com"
  };

  const result = scorePatternForEngagement(pattern, engagement);
  assert.equal(result.patternId, "p1");
  assert.equal(result.patternName, "baseline_http_headers_probe");
  assert.ok(result.applicabilityScore >= 0 && result.applicabilityScore <= 1);
  assert.match(result.reason, /type_match=/);
});
