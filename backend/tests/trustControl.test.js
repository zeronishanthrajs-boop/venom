const test = require("node:test");
const assert = require("node:assert/strict");
const {
  derivePlannedTools,
  previewEngagementActions
} = require("../services/trustControl");

test("derivePlannedTools uses whitelist when present", () => {
  const engagement = {
    targetType: "website",
    constraints: {
      toolWhitelist: ["http_headers_probe", "nuclei_scan", "http_headers_probe"]
    }
  };
  const sequence = derivePlannedTools(engagement);
  assert.deepEqual(sequence, ["http_headers_probe", "nuclei_scan"]);
});

test("previewEngagementActions produces ordered actions", () => {
  const engagement = {
    targetType: "api",
    targetUrl: "https://api.example.com",
    constraints: {}
  };
  const actions = previewEngagementActions(engagement);
  assert.ok(actions.length >= 3);
  assert.equal(actions[0].order, 1);
  assert.equal(typeof actions[0].toolId, "string");
});

