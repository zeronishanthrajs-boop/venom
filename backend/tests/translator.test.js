const test = require("node:test");
const assert = require("node:assert/strict");
const { translateAllFindings, __internal } = require("../services/translator");

test("heuristic founder translation emphasizes action", () => {
  const text = __internal.buildHeuristicFounderTranslation({
    title: "Missing CSP Header",
    severity: "medium",
    recommendation: "Add Content-Security-Policy header."
  });

  assert.match(text, /Action now:/i);
  assert.match(text, /Missing CSP Header/i);
});

test("translateAllFindings returns all audience modes", async () => {
  const findings = [
    {
      id: "f-1",
      severity: "high",
      category: "headers",
      title: "Missing Strict-Transport-Security",
      description: "HSTS header missing.",
      recommendation: "Add HSTS header.",
      source: "test"
    }
  ];
  const result = await translateAllFindings(findings);
  assert.equal(result.length, 1);
  assert.ok(result[0].translations.founder.length > 0);
  assert.ok(result[0].translations.engineer.length > 0);
  assert.ok(result[0].translations.brief.length > 0);
});

