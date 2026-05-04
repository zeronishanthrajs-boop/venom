const test = require("node:test");
const assert = require("node:assert/strict");
const { __internal } = require("../services/changeDetector");

test("computeRiskScore weights severity correctly", () => {
  const score = __internal.computeRiskScore([
    { severity: "critical" },
    { severity: "high" },
    { severity: "medium" }
  ]);
  assert.ok(score >= 70);
  assert.ok(score <= 100);
});

test("extractPortsFromJobs deduplicates host/port pairs", () => {
  const ports = __internal.extractPortsFromJobs([
    {
      output: {
        openPorts: [
          { host: "1.1.1.1", port: 443, protocol: "tcp", service: "https" },
          { host: "1.1.1.1", port: 443, protocol: "tcp", service: "https" }
        ]
      }
    }
  ]);

  assert.equal(ports.length, 1);
  assert.equal(ports[0].port, 443);
});

