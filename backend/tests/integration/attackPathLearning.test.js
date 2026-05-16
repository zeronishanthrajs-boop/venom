const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const mongoose = require("mongoose");

process.env.VENOM_API_KEY = process.env.VENOM_API_KEY || "test-key";
process.env.VALID_API_KEYS = process.env.VALID_API_KEYS || "test-key";
process.env.ENABLE_INMEMORY_DB = "true";
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_MAX = "10000";

const { createApp } = require("../../app");
const { connectDB, stopInMemoryServer } = require("../../config/db");
const Engagement = require("../../models/Engagement");
const Pattern = require("../../models/Pattern");
const Plan = require("../../models/Plan");
const {
  recordToolOutcome,
  getRecommendedTools
} = require("../../services/attackGraphService");

const app = createApp();

test.before(async () => {
  await connectDB();
});

test.after(async () => {
  await mongoose.disconnect();
  await stopInMemoryServer();
});

test.beforeEach(async () => {
  await Promise.all([
    Engagement.deleteMany({}),
    Pattern.deleteMany({}),
    Plan.deleteMany({})
  ]);
});

test("records tool outcome and creates attack graph pattern", async () => {
  await recordToolOutcome(
    "eng-1",
    "sqlmap_detect",
    [{ title: "SQL injection blocked by WAF", severity: "high" }],
    true
  );

  const pattern = await Pattern.findOne({
    "attackGraph.conditions.finding": "WAF-Detected"
  }).lean();

  assert.ok(pattern);
  assert.equal(pattern.attackGraph.conditions[0].learnedFrom, 1);
});

test("recommends tools from learned patterns", async () => {
  await recordToolOutcome(
    "eng-2",
    "sqlmap_detect",
    [{ title: "WAF detected in front of API gateway", severity: "medium" }],
    true
  );

  const recommendations = await getRecommendedTools(["WAF-Detected"]);
  assert.ok(recommendations["WAF-Detected"]);
  assert.ok(recommendations["WAF-Detected"].length > 0);
});

test("explains plan with learned pattern metadata", async () => {
  const engagement = await Engagement.create({
    name: "Learning explain test",
    targetUrl: "https://example.com",
    targetType: "website",
    authorization: {
      engagementId: "eng-x",
      authorizedBy: "test-user",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 1000 * 60 * 60),
      scopeOfWork: "test"
    }
  });

  await Plan.create({
    engagementId: engagement._id,
    promptVersion: "planning_v2_test",
    plannerSource: "template",
    model: "template-planner-v1",
    summary: "Plan with learned patterns",
    phases: [
      {
        name: "Phase",
        goal: "Goal",
        priorityScore: 5,
        riskLevel: "medium",
        checks: [],
        evidence: [],
        stopConditions: []
      }
    ],
    rationale: "Based on learned WAF pattern from prior runs.",
    confidence: 0.86,
    learnedPatterns: [
      {
        condition: "WAF-Detected",
        confidence: 0.82,
        learnedFrom: 4,
        successRate: 0.75
      }
    ],
    learnedRecommendations: [
      {
        condition: "WAF-Detected",
        tool: "sqlmap_detect",
        paramAdjustment: { tamper: "space2comment" },
        expectedSuccess: 0.79
      }
    ],
    riskNotes: [],
    disclaimers: [],
    inputSnapshot: {},
    rawModelOutput: "",
    createdBy: "test-user"
  });

  const response = await request(app)
    .get(`/api/plan/${engagement._id}/explain`)
    .set("x-api-key", "test-key")
    .set("x-user-id", "test-user")
    .set("x-user-role", "admin");

  assert.equal(response.status, 200);
  assert.equal(response.body.explanation, "Based on learned WAF pattern from prior runs.");
  assert.ok(Array.isArray(response.body.learnedPatterns));
  assert.equal(response.body.learnedPatterns.length, 1);
  assert.ok(Array.isArray(response.body.plan));
  assert.equal(response.body.plan[0].tool, "sqlmap_detect");
});
