const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.NODE_ENV = "test";
process.env.ENABLE_INMEMORY_DB = "true";

const { connectDB, stopInMemoryServer } = require("../config/db");
const Pattern = require("../models/Pattern");
const {
  recordToolOutcome,
  extractConditions,
  getRecommendedTools,
  getSuggestedParams
} = require("../services/attackGraphService");

test.before(async () => {
  await connectDB();
});

test.after(async () => {
  await mongoose.disconnect();
  await stopInMemoryServer();
});

test.beforeEach(async () => {
  await Pattern.deleteMany({});
});

test("extractConditions detects defensive signals from findings", () => {
  const findings = [
    {
      title: "ModSecurity WAF detected in front of app",
      description: "CORS response mismatch",
      severity: "high"
    },
    {
      title: "JWT bearer token missing validation",
      severity: "medium"
    }
  ];

  const conditions = extractConditions(findings);
  const keys = conditions.map((item) => item.type);
  assert.ok(keys.includes("WAF-Detected"));
  assert.ok(keys.includes("CORS-Misconfigured"));
  assert.ok(keys.includes("JWT-Auth"));
});

test("recordToolOutcome creates attack graph entry for new condition", async () => {
  await recordToolOutcome(
    "eng-1",
    "sqlmap_detect",
    [{ title: "WAF blocking SQL probes", severity: "high" }],
    true
  );

  const pattern = await Pattern.findOne({
    "attackGraph.conditions.finding": "WAF-Detected"
  }).lean();
  assert.ok(pattern);
  assert.ok(Array.isArray(pattern.attackGraph.conditions));
  assert.equal(pattern.attackGraph.conditions[0].learnedFrom, 1);
  assert.equal(pattern.attackGraph.conditions[0].successRate, 1);
  assert.ok(pattern.attackGraph.conditions[0].nextTools.length > 0);
});

test("recordToolOutcome updates learned counters and success rate", async () => {
  await recordToolOutcome(
    "eng-1",
    "sqlmap_detect",
    [{ title: "SQL injection blocked by WAF", severity: "high" }],
    true
  );
  await recordToolOutcome(
    "eng-2",
    "sqlmap_detect",
    [{ title: "WAF detected with stricter filtering", severity: "high" }],
    false
  );

  const pattern = await Pattern.findOne({
    "attackGraph.conditions.finding": "WAF-Detected"
  }).lean();
  const condition = pattern.attackGraph.conditions.find(
    (item) => item.finding === "WAF-Detected"
  );
  assert.equal(condition.learnedFrom, 2);
  assert.equal(condition.successRate, 0.5);
});

test("getRecommendedTools returns ranked suggestions", async () => {
  await recordToolOutcome(
    "eng-3",
    "sqlmap_detect",
    [{ title: "WAF detected", severity: "medium" }],
    true
  );

  const recommendations = await getRecommendedTools(["WAF-Detected"]);
  assert.ok(Array.isArray(recommendations["WAF-Detected"]));
  assert.ok(recommendations["WAF-Detected"].length > 0);
  assert.equal(recommendations["WAF-Detected"][0].tool, "sqlmap_detect");
});

test("getSuggestedParams returns tuned params for known condition", () => {
  const params = getSuggestedParams("sqlmap_detect", ["WAF-Detected"]);
  assert.equal(params.tamper, "space2comment");
  assert.equal(params.technique, "BEUSTQ");
});
