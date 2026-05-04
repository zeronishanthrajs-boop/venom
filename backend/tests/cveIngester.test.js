const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCveQuery,
  computeRelevanceScore,
  inferTagsHeuristic,
  pickCvssMetric,
  normalizeCveRecord
} = require("../services/cveIngester");

test("buildCveQuery applies bounded limit and severity filter", () => {
  const query = buildCveQuery({
    limit: 999,
    sinceDays: 3,
    severity: "critical"
  });

  assert.equal(query.get("resultsPerPage"), "200");
  assert.equal(query.get("cvssV3Severity"), "CRITICAL");
  assert.ok(query.get("pubStartDate"));
});

test("pickCvssMetric returns best available CVSS block", () => {
  const picked = pickCvssMetric({
    cvssMetricV2: [
      {
        cvssData: {
          version: "2.0",
          baseScore: 5.0,
          vectorString: "AV:N/AC:L/Au:N/C:P/I:N/A:N"
        }
      }
    ],
    cvssMetricV31: [
      {
        cvssData: {
          version: "3.1",
          baseScore: 8.8,
          baseSeverity: "HIGH",
          vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
        }
      }
    ]
  });

  assert.equal(picked.score, 8.8);
  assert.equal(picked.severity, "HIGH");
  assert.equal(picked.version, "3.1");
});

test("normalizeCveRecord extracts core fields and tags", () => {
  const normalized = normalizeCveRecord({
    cve: {
      id: "CVE-2099-0001",
      published: "2026-05-01T01:00:00.000Z",
      lastModified: "2026-05-02T02:00:00.000Z",
      sourceIdentifier: "nvd@nist.gov",
      vulnStatus: "Analyzed",
      cisaExploitAdd: "2026-05-03",
      descriptions: [
        { lang: "en", value: "Example vulnerability description." }
      ],
      weaknesses: [
        {
          description: [{ lang: "en", value: "CWE-79 Improper Neutralization" }]
        }
      ],
      references: [{ url: "https://example.com/advisory" }],
      configurations: [
        {
          nodes: [{ cpeMatch: [{ criteria: "cpe:2.3:a:vendor:product:1.0:*:*:*:*:*:*:*" }] }]
        }
      ],
      metrics: {
        cvssMetricV31: [
          {
            cvssData: {
              version: "3.1",
              baseScore: 9.1,
              baseSeverity: "CRITICAL",
              vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
            }
          }
        ]
      }
    }
  });

  assert.equal(normalized.cveId, "CVE-2099-0001");
  assert.equal(normalized.cvssScore, 9.1);
  assert.equal(normalized.cvssSeverity, "CRITICAL");
  assert.deepEqual(normalized.cweIds, ["CWE-79"]);
  assert.ok(normalized.tags.includes("known-exploited"));
  assert.ok(normalized.tags.includes("critical"));
  assert.equal(normalized.severity, "CRITICAL");
  assert.equal(normalized.exploitAvailable, true);
});

test("inferTagsHeuristic detects common web auth attack classes", () => {
  const tags = inferTagsHeuristic({
    description:
      "Authentication bypass in GraphQL API allows SQL injection and information disclosure.",
    cweIds: ["CWE-287", "CWE-89"],
    cpes: ["cpe:2.3:a:wordpress:wordpress:6.5:*:*:*:*:*:*:*"]
  });

  assert.ok(tags.includes("auth"));
  assert.ok(tags.includes("api"));
  assert.ok(tags.includes("sqli"));
  assert.ok(tags.includes("cms"));
});

test("computeRelevanceScore increases with high score, priority tags and KEV signal", () => {
  const low = computeRelevanceScore({
    cvssScore: 4.3,
    applicabilityTags: ["information-disclosure"],
    exploitAvailable: false
  });
  const high = computeRelevanceScore({
    cvssScore: 9.1,
    applicabilityTags: ["rce", "auth", "web"],
    exploitAvailable: true
  });

  assert.ok(high > low);
  assert.ok(high <= 100);
});
