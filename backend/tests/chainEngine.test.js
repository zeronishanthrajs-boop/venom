const test = require("node:test");
const assert = require("node:assert/strict");
const { __internal } = require("../services/chainEngine");

test("buildHeuristicChainSteps prioritizes network-first chain for network targets", () => {
  const steps = __internal.buildHeuristicChainSteps(
    {
      targetType: "network"
    },
    []
  );

  assert.ok(Array.isArray(steps));
  assert.equal(steps[0].toolId, "nmap_tcp_scan");
});

test("buildHeuristicChainSteps adds sqlmap when findings indicate injection signals", () => {
  const steps = __internal.buildHeuristicChainSteps(
    {
      targetType: "website"
    },
    [
      {
        title: "Potential SQL injection signal",
        description: "Database injection behavior suspected"
      }
    ]
  );

  const hasSqlmap = steps.some((step) => step.toolId === "sqlmap_detect");
  assert.equal(hasSqlmap, true);
});

test("sanitizeChainSteps enforces allowed tool set and removes duplicates", () => {
  const sanitized = __internal.sanitizeChainSteps(
    [
      { toolId: "http_headers_probe", name: "A" },
      { toolId: "http_headers_probe", name: "B" },
      { toolId: "unknown_tool", name: "C" }
    ],
    {
      constraints: {
        toolWhitelist: [],
        noDestructiveOps: true
      }
    }
  );

  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].toolId, "http_headers_probe");
});
