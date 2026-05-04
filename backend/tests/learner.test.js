const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildHeuristicPatternCandidates,
  inferTagsFromFinding,
  sanitizePatternCandidate
} = require("../services/learner");

test("inferTagsFromFinding captures defensive signal tags", () => {
  const tags = inferTagsFromFinding({
    severity: "medium",
    category: "header-hardening",
    title: "Missing Strict-Transport-Security Header",
    description: "HSTS is not configured"
  });

  assert.ok(tags.includes("header-hardening"));
  assert.ok(tags.includes("misconfiguration"));
  assert.ok(tags.includes("web"));
});

test("buildHeuristicPatternCandidates creates candidates from repeated findings", () => {
  const jobs = [
    {
      status: "success",
      findings: [
        {
          severity: "medium",
          category: "header-hardening",
          title: "Missing CSP",
          description: "No CSP"
        }
      ]
    },
    {
      status: "success",
      findings: [
        {
          severity: "medium",
          category: "header-hardening",
          title: "Missing HSTS",
          description: "No HSTS"
        }
      ]
    }
  ];
  const candidates = buildHeuristicPatternCandidates({
    jobs,
    engagementTargetType: "website"
  });

  assert.ok(candidates.length >= 1);
  assert.match(candidates[0].name, /^heuristic_/);
  assert.equal(candidates[0].targetType, "website");
});

test("sanitizePatternCandidate rejects low-generalization candidates", () => {
  const rejected = sanitizePatternCandidate(
    {
      name: "weak candidate",
      generalizationScore: 0.3,
      estimatedSuccessRate: 0.9,
      tags: ["web"]
    },
    "website"
  );
  assert.equal(rejected, null);
});

test("sanitizePatternCandidate keeps safe normalized values", () => {
  const sanitized = sanitizePatternCandidate(
    {
      name: "Strong Candidate Pattern",
      description: "Reusable validation flow",
      targetType: "api",
      tags: ["web", "api", "unknown-tag"],
      prerequisites: ["authorized_scope"],
      assessmentSequence: ["collect evidence"],
      estimatedSuccessRate: 0.74,
      generalizationScore: 0.81
    },
    "website"
  );

  assert.ok(sanitized);
  assert.equal(sanitized.name, "strong_candidate_pattern");
  assert.equal(sanitized.targetType, "api");
  assert.ok(sanitized.tags.includes("api"));
  assert.ok(!sanitized.tags.includes("unknown-tag"));
});

