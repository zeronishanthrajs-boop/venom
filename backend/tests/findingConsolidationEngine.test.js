const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FindingConsolidationEngine,
  buildFindingFingerprint,
  escalateSeverity
} = require("../services/findingConsolidationEngine");

function finding(overrides = {}) {
  return {
    type: "API_MISSING_RATE_LIMIT",
    title: "Missing rate limiting",
    description: "No throttling was observed on a sensitive endpoint.",
    severity: "medium",
    endpoint: "/api/login",
    confidenceScore: 82,
    metadata: {},
    ...overrides
  };
}

test("29 rate-limit findings consolidate to one critical root cause group", () => {
  const engine = new FindingConsolidationEngine();
  const findings = Array.from({ length: 29 }, (_, index) =>
    finding({
      endpoint: `/api/auth/login-${index + 1}`,
      metadata: { parameter: "auth-endpoints" }
    })
  );

  const result = engine.consolidate(findings);

  assert.equal(result.rawFindingCount, 29);
  assert.equal(result.consolidatedFindingCount, 1);
  assert.equal(result.consolidatedFindings[0].rootCauseId, "RATE_LIMIT_ABSENT");
  assert.equal(result.consolidatedFindings[0].instanceCount, 29);
  assert.equal(result.consolidatedFindings[0].severity, "critical");
  assert.equal(result.consolidatedFindings[0].affectedAssets.length, 29);
});

test("different root causes produce separate groups", () => {
  const engine = new FindingConsolidationEngine();
  const result = engine.consolidate([
    finding({ type: "API_MISSING_RATE_LIMIT", metadata: { parameter: "auth" } }),
    finding({
      type: "SECRET_FOUND",
      title: "Hardcoded API key",
      description: "A secret token was found.",
      endpoint: "repo:file.js",
      metadata: { parameter: "github-token" }
    }),
    finding({
      type: "SQL_INJECTION",
      title: "SQL injection risk",
      description: "SQL injection canary changed the response.",
      endpoint: "/search?q=test",
      metadata: { parameter: "q" }
    })
  ]);

  assert.equal(result.consolidatedFindingCount, 3);
  assert.deepEqual(
    result.consolidatedFindings.map((item) => item.rootCauseId).sort(),
    ["INJECTION_VECTOR", "RATE_LIMIT_ABSENT", "SECRETS_EXPOSURE"]
  );
});

test("duplicate fingerprints merge into the existing group", () => {
  const engine = new FindingConsolidationEngine();
  const duplicateA = finding({
    endpoint: "/api/login",
    affectedParameter: "login-policy"
  });
  const duplicateB = finding({
    endpoint: "/api/login",
    affectedParameter: "login-policy"
  });

  const result = engine.consolidate([duplicateA, duplicateB]);

  assert.equal(buildFindingFingerprint(duplicateA), buildFindingFingerprint(duplicateB));
  assert.equal(result.consolidatedFindingCount, 1);
  assert.equal(result.consolidatedFindings[0].instanceCount, 2);
  assert.equal(result.consolidationAudit[1].action, "merged_duplicate_fingerprint");
});

test("12 medium findings on one root cause escalate to critical", () => {
  const engine = new FindingConsolidationEngine();
  const findings = Array.from({ length: 12 }, (_, index) =>
    finding({
      severity: "medium",
      endpoint: `/api/private/${index + 1}`,
      metadata: { parameter: "private-api" }
    })
  );

  const result = engine.consolidate(findings);

  assert.equal(result.consolidatedFindingCount, 1);
  assert.equal(result.consolidatedFindings[0].severity, "critical");
  assert.equal(escalateSeverity("medium", 12), "critical");
});
