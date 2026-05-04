const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeContextualSeverity,
  __internal
} = require("../services/decisionEngine");

test("computeContextualSeverity boosts public-facing exploitable findings", () => {
  const engagement = {
    targetType: "website",
    targetUrl: "https://example.com"
  };
  const finding = {
    severity: "medium",
    tags: ["sqli"],
    cve: "CVE-2026-1000",
    cvssScore: 6.4
  };

  const score = computeContextualSeverity(finding, engagement);
  assert.ok(score > 64);
  assert.ok(score <= 100);
});

test("buildHeuristicDecision returns top risks and ignore list", () => {
  const scoredFindings = [
    {
      title: "Critical RCE",
      severity: "critical",
      contextualSeverity: 95,
      recommendation: "Patch immediately. Restart service."
    },
    {
      title: "Missing header",
      severity: "low",
      contextualSeverity: 20,
      recommendation: "Set header."
    }
  ];

  const brief = __internal.buildHeuristicDecision(scoredFindings);
  assert.equal(brief.topThreeRisks.length, 1);
  assert.equal(brief.topThreeRisks[0].title, "Critical RCE");
  assert.equal(brief.ignoreReasons.length, 1);
});

