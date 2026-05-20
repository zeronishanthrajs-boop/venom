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
const ExecutionJob = require("../../models/ExecutionJob");

const app = createApp();

function authHeaders() {
  return {
    "x-api-key": "test-key",
    "x-user-id": "tester@example.com",
    "x-user-role": "admin"
  };
}

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
    ExecutionJob.deleteMany({})
  ]);
});

test("GET /api/metrics/security-trends aggregates categories, computes AI risk index, and ranks vulnerable targets", async () => {
  const engagement1 = await Engagement.create({
    name: "Target A",
    targetUrl: "https://target-a.local",
    targetType: "website",
    status: "completed",
    authorization: {
      engagementId: "eng-a",
      authorizedBy: "tester@example.com",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 60 * 60 * 1000)
    }
  });

  const engagement2 = await Engagement.create({
    name: "Target B",
    targetUrl: "https://target-b.local",
    targetType: "website",
    status: "completed",
    authorization: {
      engagementId: "eng-b",
      authorizedBy: "tester@example.com",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 60 * 60 * 1000)
    }
  });

  // Seed normal job with high secrets finding
  await ExecutionJob.create({
    engagementId: engagement1._id,
    toolId: "secrets_scan",
    targetUrl: "https://target-a.local",
    status: "success",
    findings: [
      {
        id: "sec-1",
        severity: "high",
        category: "Secrets",
        title: "AWS Access Key Leak",
        source: "secrets_detection"
      }
    ],
    createdAt: new Date("2026-05-18T10:00:00Z")
  });

  // Seed AI job with prompt injection and exposed LLM key
  await ExecutionJob.create({
    engagementId: engagement2._id,
    toolId: "ai_app_scan",
    targetUrl: "https://target-b.local",
    status: "success",
    findings: [
      {
        id: "ai-1",
        severity: "critical",
        category: "AI & LLM Security",
        title: "Prompt Injection vulnerable",
        source: "ai_scanner",
        tags: ["ai", "prompt-injection"],
        metadata: { type: "PROMPT_INJECTION_VULNERABLE" }
      },
      {
        id: "ai-2",
        severity: "medium",
        category: "AI & LLM Security",
        title: "Exposed OpenAI Key",
        source: "ai_scanner",
        tags: ["ai", "key-exposure"],
        metadata: { type: "EXPOSED_LLM_KEY" }
      }
    ],
    createdAt: new Date("2026-05-19T10:00:00Z")
  });

  const res = await request(app)
    .get("/api/metrics/security-trends")
    .set(authHeaders());

  assert.equal(res.status, 200);

  // Check categories aggregation
  assert.equal(res.body.categoryCounts["Secrets"], 1);
  assert.equal(res.body.categoryCounts["AI & LLM Security"], 2);

  // Check severity counts
  assert.equal(res.body.severityCounts["critical"], 1);
  assert.equal(res.body.severityCounts["high"], 1);
  assert.equal(res.body.severityCounts["medium"], 1);

  // Check AI Risk Index is computed (1 critical [10 points] + 1 medium [2 points] = 12 points. Normalized against 1 AI scan = 120, capped at 100)
  assert.ok(res.body.aiRiskIndex > 0);
  assert.ok(res.body.aiRiskIndex <= 100);

  // Check ranked targets
  assert.equal(res.body.vulnerableTargets.length, 2);
  // Target B score: 1 critical (10) + 1 medium (2) = 12. Target A score: 1 high (5) = 5. Target B must be first.
  assert.equal(res.body.vulnerableTargets[0].target, "https://target-b.local");
  assert.equal(res.body.vulnerableTargets[1].target, "https://target-a.local");

  // Check daily trends
  assert.ok(res.body.dailyTrends.length > 0);
  const trendDays = res.body.dailyTrends.map(t => t.date);
  assert.ok(trendDays.includes("2026-05-18"));
  assert.ok(trendDays.includes("2026-05-19"));
});
