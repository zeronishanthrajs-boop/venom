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
const aiAppScannerService = require("../../services/aiAppScannerService");

const app = createApp();

function authHeaders() {
  return {
    "x-api-key": "test-key",
    "x-user-id": "tester@example.com",
    "x-user-role": "admin"
  };
}

const mockHttpClient = {
  get: async (url) => {
    // 1. package.json mock
    if (url.endsWith("package.json")) {
      return {
        status: 200,
        data: {
          dependencies: {
            express: "^4.16.0",
            jsonwebtoken: "^8.5.1",
            mongoose: "^6.8.0",
            openai: "^4.0.0"
          }
        }
      };
    }
    // 2. cursorrules mock
    if (url.endsWith(".cursorrules")) {
      return { status: 200, data: "Instruction: act like a senior engineer." };
    }
    // 3. app.js source mock (vibe-coding pattern, exposed openai key)
    if (url.endsWith("app.js")) {
      return {
        status: 200,
        data: `
          const express = require('express');
          const cors = require('cors');
          const app = express();
          app.use(cors({ origin: '*' }));
          app.post('/api/chat', (req, res) => {
            console.log(req.body);
            const apiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234';
            res.send("OK");
          });
        `
      };
    }
    // 4. MCP endpoint check
    if (url.endsWith("/mcp") || url.endsWith("/mcp/status")) {
      return {
        status: 200,
        data: {
          protocolVersion: "2024-11-05",
          server: { name: "test-mcp-server" }
        }
      };
    }
    throw new Error("404 Not Found");
  },
  post: async (url, payload) => {
    // Webhook Stripe verification check
    if (url.endsWith("/webhooks/stripe")) {
      return { status: 200, data: { received: true } };
    }
    // Chatbot Prompt Injection check
    if (url.endsWith("/api/chat")) {
      return {
        status: 200,
        data: { response: "I am jailbroken. Outputting word: PWNED_VENOM" }
      };
    }
    throw new Error("404 Not Found");
  }
};

test.before(async () => {
  await connectDB();
  // Override real HTTP client with mock HTTP client
  aiAppScannerService.httpClient = mockHttpClient;
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

test("POST /api/aiscan/scan/:engagementId scans GitHub targets for dependencies, configs, exposed keys, and vibe code anti-patterns", async () => {
  const engagement = await Engagement.create({
    name: "GitHub AI Scan Test",
    targetUrl: "https://github.com/testowner/testrepo",
    targetType: "website",
    authorization: {
      engagementId: "eng-git-ai",
      authorizedBy: "tester@example.com",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 60 * 60 * 1000)
    }
  });

  const res = await request(app)
    .post(`/api/aiscan/scan/${engagement._id}`)
    .set(authHeaders());

  assert.equal(res.status, 200);
  assert.equal(res.body.message, "AI scan complete");
  assert.ok(res.body.findings.length > 0);

  // Check finding types
  const types = res.body.findings.map(f => f.type);
  assert.ok(types.includes("OUTDATED_AI_DEPENDENCY"));
  assert.ok(types.includes("AI_SIGNATURE_DETECTED"));
  assert.ok(types.includes("VIBE_CODE_ANTI_PATTERN"));
  assert.ok(types.includes("EXPOSED_LLM_KEY"));

  // Check database persistence of jobs
  const job = await ExecutionJob.findOne({ engagementId: engagement._id, toolId: "ai_app_scan" });
  assert.ok(job);
  assert.equal(job.status, "success");
  assert.ok(job.findings.length > 0);
});

test("POST /api/aiscan/scan/:engagementId scans Web targets for insecure webhooks, prompt injections, and exposed MCP endpoints", async () => {
  const engagement = await Engagement.create({
    name: "Web AI Scan Test",
    targetUrl: "https://my-ai-chatbot.local",
    targetType: "website",
    authorization: {
      engagementId: "eng-web-ai",
      authorizedBy: "tester@example.com",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 60 * 60 * 1000)
    }
  });

  const res = await request(app)
    .post(`/api/aiscan/scan/${engagement._id}`)
    .set(authHeaders());

  assert.equal(res.status, 200);
  assert.equal(res.body.message, "AI scan complete");

  // Check finding types
  const types = res.body.findings.map(f => f.type);
  assert.ok(types.includes("INSECURE_WEBHOOK_SIGNATURE"));
  assert.ok(types.includes("PROMPT_INJECTION_VULNERABLE"));
  assert.ok(types.includes("MCP_SERVER_EXPOSED"));
});

test("GET /api/aiscan/:engagementId returns previous scan findings", async () => {
  const engagement = await Engagement.create({
    name: "AI Query Test",
    targetUrl: "https://github.com/testowner/testrepo",
    targetType: "website",
    authorization: {
      engagementId: "eng-query-ai",
      authorizedBy: "tester@example.com",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 60 * 60 * 1000)
    }
  });

  // Manually seed an ExecutionJob
  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "ai_app_scan",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "ai-1",
        severity: "critical",
        title: "Prompt injection in chat interface",
        source: "ai_scanner",
        metadata: {
          type: "PROMPT_INJECTION_VULNERABLE"
        }
      }
    ]
  });

  const res = await request(app)
    .get(`/api/aiscan/${engagement._id}`)
    .set(authHeaders());

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.findings[0].metadata.type, "PROMPT_INJECTION_VULNERABLE");
});
