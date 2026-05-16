const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.NODE_ENV = "test";
process.env.ENABLE_INMEMORY_DB = "true";

const { connectDB, stopInMemoryServer } = require("../config/db");
const Pattern = require("../models/Pattern");
const { generatePlanForEngagement } = require("../services/planner");

let previousGeminiKey;

test.before(async () => {
  await connectDB();
  previousGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

test.after(async () => {
  if (previousGeminiKey) {
    process.env.GEMINI_API_KEY = previousGeminiKey;
  } else {
    delete process.env.GEMINI_API_KEY;
  }
  await mongoose.disconnect();
  await stopInMemoryServer();
});

test.beforeEach(async () => {
  await Pattern.deleteMany({});
});

test("generatePlanForEngagement includes learned attack graph metadata", async () => {
  await Pattern.create({
    name: "learned_condition_waf_detected",
    description: "WAF tuning pattern",
    targetType: "website",
    source: "execution-telemetry",
    attackGraph: {
      conditions: [
        {
          finding: "WAF-Detected",
          confidence: 0.86,
          learnedFrom: 5,
          successRate: 0.78,
          nextTools: [
            {
              tool: "sqlmap_detect",
              paramAdjustment: { tamper: "space2comment" },
              expectedSuccess: 0.8
            }
          ]
        }
      ],
      lastUpdated: new Date(),
      engagementsSeen: 5
    }
  });

  const result = await generatePlanForEngagement({
    _id: new mongoose.Types.ObjectId(),
    name: "Planner learning test",
    description: "",
    targetUrl: "https://example.com",
    targetType: "website",
    scope: { allowedDomains: ["example.com"], restrictedPaths: [] },
    authorization: {},
    constraints: {}
  });

  assert.equal(result.source, "template");
  assert.ok(Array.isArray(result.learnedPatterns));
  assert.ok(result.learnedPatterns.length > 0);
  assert.equal(result.learnedPatterns[0].condition, "WAF-Detected");
  assert.ok(Array.isArray(result.learnedRecommendations));
  assert.equal(result.learnedRecommendations[0].tool, "sqlmap_detect");
  assert.match(result.rationale, /learned pattern/i);
  assert.ok(typeof result.confidence === "number");
});
