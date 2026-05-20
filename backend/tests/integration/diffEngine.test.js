const test = require("node:test");
const assert = require("node:assert/strict");
const { diffFindings } = require("../../services/diffEngine");

test("diffFindings classifies fixed, new, and persisting findings", () => {
  const previous = [
    { title: "Exposed API Key", type: "SECRET_FOUND", severity: "critical", targetUrl: "http://example.com" },
    { title: "Outdated Express", type: "VULNERABLE_DEPENDENCY", severity: "high", targetUrl: "http://example.com" }
  ];

  const current = [
    { title: "Outdated Express", type: "VULNERABLE_DEPENDENCY", severity: "high", targetUrl: "http://example.com" },
    { title: "SQL Injection in Search", type: "INJECTION", severity: "critical", targetUrl: "http://example.com" }
  ];

  const diff = diffFindings(previous, current);

  assert.equal(diff.fixed.length, 1);
  assert.equal(diff.fixed[0].title, "Exposed API Key");

  assert.equal(diff.new.length, 1);
  assert.equal(diff.new[0].title, "SQL Injection in Search");

  assert.equal(diff.persisting.length, 1);
  assert.equal(diff.persisting[0].title, "Outdated Express");
});
