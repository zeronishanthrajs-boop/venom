const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeOverallCvssScore,
  extractFindingTags,
  generateComplianceSummary,
  mapFindingsToOwasp
} = require("../services/complianceMapper");

test("extractFindingTags infers useful compliance tags", () => {
  const tags = extractFindingTags({
    category: "header-hardening",
    title: "Missing Content-Security-Policy Header",
    description: "No CSP makes script injection impact higher",
    severity: "medium"
  });

  assert.ok(tags.includes("header-hardening"));
  assert.ok(tags.includes("web"));
  assert.ok(tags.includes("misconfiguration"));
});

test("mapFindingsToOwasp maps findings to expected categories", () => {
  const mapped = mapFindingsToOwasp([
    {
      severity: "high",
      category: "known-cve",
      title: "Known vulnerable component version",
      description: "CVE-driven vulnerable component exposure",
      cve: "CVE-2026-1234"
    },
    {
      severity: "medium",
      category: "header-hardening",
      title: "Missing Content-Security-Policy Header",
      description: "missing CSP"
    }
  ]);

  assert.ok(mapped.A06);
  assert.ok(mapped.A05);
});

test("computeOverallCvssScore blends max and average severity", () => {
  const score = computeOverallCvssScore([
    { severity: "high", cvssScore: 8.8 },
    { severity: "medium", cvssScore: 5.3 },
    { severity: "low", cvssScore: 3.1 }
  ]);
  assert.ok(score >= 7.5 && score <= 9.5);
});

test("generateComplianceSummary returns cvss + owasp breakdown", () => {
  const summary = generateComplianceSummary([
    {
      severity: "critical",
      category: "known-cve",
      title: "Known CVE exposure",
      description: "Potential remote code execution via known component CVE",
      cve: "CVE-2026-9999"
    },
    {
      severity: "medium",
      category: "header-hardening",
      title: "Missing Content-Security-Policy Header",
      description: "No CSP observed"
    }
  ]);

  assert.ok(summary.cvssOverallScore > 0);
  assert.ok(["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(summary.cvssSeverity));
  assert.ok(summary.owaspCoverage >= 1);
  assert.ok(Array.isArray(summary.remediationPriority));
});

