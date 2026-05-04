const test = require("node:test");
const assert = require("node:assert/strict");
const { __internal } = require("../services/orchestrator");

test("deriveToolSequenceFromPlan includes baseline probes", () => {
  const sequence = __internal.deriveToolSequenceFromPlan(
    {
      phases: [
        {
          name: "Surface discovery",
          goal: "Identify exposed services and ports",
          checks: ["port exposure", "network inventory"]
        }
      ]
    },
    "website"
  );

  assert.equal(sequence[0], "http_headers_probe");
  assert.ok(sequence.includes("dns_lookup_probe"));
  assert.ok(sequence.includes("tls_metadata_probe"));
});

test("deriveToolSequenceFromPlan adds SQLMap when plan mentions injection", () => {
  const sequence = __internal.deriveToolSequenceFromPlan(
    {
      phases: [
        {
          name: "API validation",
          goal: "Assess parameter injection behaviors",
          checks: ["check SQL injection vectors"]
        }
      ]
    },
    "api"
  );

  assert.ok(sequence.includes("sqlmap_detect"));
});

test("deriveToolSequenceFromPlan falls back to defaults for missing phases", () => {
  const sequence = __internal.deriveToolSequenceFromPlan(null, "network");
  assert.deepEqual(
    sequence.slice(0, 4),
    ["nmap_tcp_scan", "dns_lookup_probe", "tls_metadata_probe", "nuclei_scan"]
  );
});
