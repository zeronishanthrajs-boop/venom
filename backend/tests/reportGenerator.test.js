const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeSeverityBreakdown,
  flattenFindings
} = require("../services/reportGenerator");

test("flattenFindings prefers job.findings and falls back to output.findings", () => {
  const flattened = flattenFindings([
    {
      findings: [{ title: "A" }]
    },
    {
      output: {
        findings: [{ title: "B" }]
      }
    },
    {
      output: {}
    }
  ]);

  assert.equal(flattened.length, 2);
  assert.equal(flattened[0].title, "A");
  assert.equal(flattened[1].title, "B");
});

test("computeSeverityBreakdown counts finding severities", () => {
  const summary = computeSeverityBreakdown([
    { severity: "critical" },
    { severity: "high" },
    { severity: "high" },
    { severity: "medium" },
    { severity: "low" },
    { severity: "info" }
  ]);

  assert.deepEqual(summary, {
    critical: 1,
    high: 2,
    medium: 1,
    low: 1,
    info: 1
  });
});

