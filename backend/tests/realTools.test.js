const test = require("node:test");
const assert = require("node:assert/strict");
const { __internal } = require("../tooling/realTools");

test("parseNmapOutput extracts open port findings", () => {
  const parsed = __internal.parseNmapOutput(
    `
22/tcp open  ssh OpenSSH 9.0
80/tcp open  http Apache httpd 2.4.57
`
  );

  assert.equal(parsed.ports.length, 2);
  assert.equal(parsed.findings.length, 2);
  assert.equal(parsed.findings[0].id, "nmap-open-port-22");
});

test("parseNucleiOutput parses jsonl findings", () => {
  const parsed = __internal.parseNucleiOutput(
    JSON.stringify({
      "template-id": "cve-test-001",
      info: {
        name: "Test CVE",
        severity: "high",
        classification: {
          cve_id: "CVE-2026-0001"
        }
      },
      matched: "https://example.com"
    })
  );

  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].severity, "high");
  assert.equal(parsed.findings[0].cve, "CVE-2026-0001");
});

test("parseSqlmapOutput flags potential injection text", () => {
  const parsed = __internal.parseSqlmapOutput(
    "Parameter: id (GET) appears to be injectable and target is vulnerable"
  );

  assert.equal(parsed.isVulnerable, true);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].category, "injection-detection");
});
