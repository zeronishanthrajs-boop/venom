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
const Plan = require("../../models/Plan");

const app = createApp();

function authHeaders() {
  return {
    "x-api-key": "test-key",
    "x-user-id": "tester@example.com",
    "x-user-role": "admin"
  };
}

function buildEngagementPayload(name = "Report Intel Test") {
  return {
    name,
    targetUrl: "https://secure-target.local",
    targetType: "website",
    authorization: {
      engagementId: "eng-intel-test",
      authorizedBy: "tester@example.com",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 60 * 60 * 1000)
    }
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
    ExecutionJob.deleteMany({}),
    Plan.deleteMany({})
  ]);
});

test("GET /api/reports/:engagementId/html supports manager and developer modes", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("HTML mode test"));
  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "port_scanner",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "port-1",
        severity: "critical",
        type: "OPEN_PORT",
        category: "Port Scan",
        title: "Exposed database service",
        description: "Postgres port is accessible from public internet.",
        recommendation: "Restrict firewall rules.",
        source: "port_scanner"
      }
    ]
  });

  // Test manager mode
  const resManager = await request(app)
    .get(`/api/reports/${engagement._id}/html?mode=manager`)
    .set(authHeaders());

  assert.equal(resManager.status, 200);
  assert.match(resManager.text, /Manager View/i);
  assert.match(resManager.text, /Breach/i);
  assert.match(resManager.text, /Exploit Prob/i);

  // Test developer mode
  const resDeveloper = await request(app)
    .get(`/api/reports/${engagement._id}/html?mode=developer`)
    .set(authHeaders());

  assert.equal(resDeveloper.status, 200);
  assert.match(resDeveloper.text, /Developer View/i);
  assert.match(resDeveloper.text, /Reproduction Steps/i);
  assert.match(resDeveloper.text, /SHA-256 Digest/i);
});

test("POST /api/reports/:engagementId/share creates signed link and GET /api/public/reports/:shareToken accesses it", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Share test"));
  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "port_scanner",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "port-1",
        severity: "high",
        type: "OPEN_PORT",
        category: "Port Scan",
        title: "Exposed database service",
        description: "Postgres port is accessible from public internet.",
        recommendation: "Restrict firewall rules.",
        source: "port_scanner"
      }
    ]
  });

  const resShare = await request(app)
    .post(`/api/reports/${engagement._id}/share`)
    .send({ expiryDays: 2 })
    .set(authHeaders());

  assert.equal(resShare.status, 200);
  assert.ok(resShare.body.shareToken);
  assert.ok(resShare.body.shareUrl);
  assert.ok(resShare.body.expiresAt);

  const shareToken = resShare.body.shareToken;

  // Fetch report using the public endpoint (without auth headers)
  const resPublic = await request(app)
    .get(`/api/public/reports/${shareToken}?mode=manager`);

  assert.equal(resPublic.status, 200);
  assert.match(resPublic.text, /Manager View/i);
  assert.match(resPublic.text, /secure-target.local/i);

  // Invalid token check
  const resInvalid = await request(app)
    .get("/api/public/reports/invalidtoken123");
  assert.equal(resInvalid.status, 401);
});

test("POST /api/reports/:engagementId/chat provides security chatbot responses", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Chat test"));
  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "port_scanner",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "port-1",
        severity: "critical",
        type: "OPEN_PORT",
        category: "Port Scan",
        title: "Exposed database service",
        description: "Postgres port is accessible from public internet.",
        recommendation: "Restrict firewall rules.",
        source: "port_scanner"
      }
    ]
  });

  const resChat = await request(app)
    .post(`/api/reports/${engagement._id}/chat`)
    .send({ message: "What are the critical risks in this report?" })
    .set(authHeaders());

  assert.equal(resChat.status, 200);
  assert.ok(resChat.body.response);
  assert.match(resChat.body.response, /Heuristic Mode/i);
  assert.match(resChat.body.response, /exposed database service/i);
});

test("GET /api/reports/:engagementId/compare/:previousId executes scan comparison", async () => {
  const previousEngagement = await Engagement.create(buildEngagementPayload("Previous Scan"));
  const currentEngagement = await Engagement.create(buildEngagementPayload("Current Scan"));

  // Previous Scan Findings: open database port, old lodash
  await ExecutionJob.create({
    engagementId: previousEngagement._id,
    toolId: "port_scanner",
    targetUrl: previousEngagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "port-1",
        severity: "critical",
        title: "Exposed database service",
        source: "port_scanner"
      },
      {
        id: "dep-1",
        severity: "high",
        title: "lodash vulnerable",
        source: "supply_chain"
      }
    ]
  });

  // Current Scan Findings: old lodash (persisting), missing security headers (new)
  // Exposed database service is fixed.
  await ExecutionJob.create({
    engagementId: currentEngagement._id,
    toolId: "supply_chain",
    targetUrl: currentEngagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "dep-1",
        severity: "high",
        title: "lodash vulnerable",
        source: "supply_chain"
      },
      {
        id: "header-1",
        severity: "medium",
        title: "Missing Content-Security-Policy Header",
        source: "http_headers_probe"
      }
    ]
  });

  const resCompare = await request(app)
    .get(`/api/reports/${currentEngagement._id}/compare/${previousEngagement._id}`)
    .set(authHeaders());

  assert.equal(resCompare.status, 200);
  assert.equal(resCompare.body.summary.fixedCount, 1);
  assert.equal(resCompare.body.summary.newCount, 1);
  assert.equal(resCompare.body.summary.persistingCount, 1);

  assert.equal(resCompare.body.findingsDiff.fixed[0].title, "Exposed database service");
  assert.equal(resCompare.body.findingsDiff.new[0].title, "Missing Content-Security-Policy Header");
  assert.equal(resCompare.body.findingsDiff.persisting[0].title, "lodash vulnerable");
});
