const test = require("node:test");
const assert = require("node:assert/strict");

const { __internal } = require("../services/researchEngine");

test("buildAssessmentSequence includes sqlmap for api/sqli tags", () => {
  const sequence = __internal.buildAssessmentSequence(["api", "sqli"]);
  assert.ok(sequence.includes("sqlmap_detect"));
  assert.equal(sequence[0], "http_headers_probe");
});

test("mapCisaKevToPatternCandidate builds known-exploited candidate", () => {
  const candidate = __internal.mapCisaKevToPatternCandidate({
    cveID: "CVE-2026-0001",
    shortDescription: "Authentication bypass in API gateway",
    product: "Gateway",
    vendorProject: "VendorX"
  });

  assert.equal(candidate.name, "CISA KEV Focus: CVE-2026-0001");
  assert.ok(candidate.tags.includes("known-exploited"));
  assert.ok(candidate.assessmentSequence.includes("nuclei_scan"));
});

test("mapGithubAdvisoryToPatternCandidate maps severity and tags", () => {
  const candidate = __internal.mapGithubAdvisoryToPatternCandidate({
    ghsa_id: "GHSA-1234-5678-ABCD",
    severity: "high",
    summary: "SQL injection in API endpoint"
  });

  assert.equal(candidate.targetType, "api");
  assert.ok(candidate.tags.includes("sqli"));
  assert.ok(candidate.successRate >= 0.55);
});

test("getNvdRequestHeaders includes apiKey when configured", () => {
  const previous = process.env.NVD_API_KEY;
  process.env.NVD_API_KEY = "nvd-test-key";
  const headers = __internal.getNvdRequestHeaders({
    "User-Agent": "VENOM-ResearchEngine/3.0"
  });
  assert.equal(headers.apiKey, "nvd-test-key");
  if (previous === undefined) {
    delete process.env.NVD_API_KEY;
  } else {
    process.env.NVD_API_KEY = previous;
  }
});

test("shouldRetryNvdStatus retries for throttling and transient failures", () => {
  assert.equal(__internal.shouldRetryNvdStatus(429), true);
  assert.equal(__internal.shouldRetryNvdStatus(503), true);
  assert.equal(__internal.shouldRetryNvdStatus(403), true);
  assert.equal(__internal.shouldRetryNvdStatus(404), false);
});

test("computeNvdBackoffMs honors retry-after when larger than exponential delay", () => {
  const backoff = __internal.computeNvdBackoffMs({
    attempt: 1,
    retryAfterMs: 12000,
    hasApiKey: false
  });
  assert.equal(backoff >= 12000, true);
});
