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
const supplyChainService = require("../../services/supplyChainService");

const app = createApp();

function authHeaders() {
  return {
    "x-api-key": "test-key",
    "x-user-id": "tester@example.com",
    "x-user-role": "admin"
  };
}

function buildEngagementPayload(name = "Supply Chain Test") {
  return {
    name,
    targetUrl: "https://github.com/public/repo",
    targetType: "website",
    authorization: {
      engagementId: "eng-supply",
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
  await Promise.all([Engagement.deleteMany({}), ExecutionJob.deleteMany({})]);
});

test("checkNpmAdvisory detects known vulnerable express version", async () => {
  const advisory = await supplyChainService.checkNpmAdvisory("express", "4.17.1");
  assert.ok(advisory);
  assert.equal(advisory.type, "VULNERABLE_DEPENDENCY");
  assert.match(advisory.cve, /CVE/i);
});

test("checkNpmAdvisory returns null for safe versions", async () => {
  const advisory = await supplyChainService.checkNpmAdvisory("express", "4.18.2");
  assert.equal(advisory, null);
});

test("POST /api/supplychain/scan/:engagementId stores execution job", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Supply route POST"));
  const originalScan = supplyChainService.scanEngagement;
  supplyChainService.scanEngagement = async () => ({
    findings: [
      {
        id: "dep-1",
        type: "VULNERABLE_DEPENDENCY",
        severity: "high",
        category: "Supply Chain",
        title: "lodash vulnerable",
        description: "lodash@4.17.20 vulnerable",
        recommendation: "Upgrade lodash",
        source: "supply_chain",
        cve: "CVE-2021-23337",
        tags: ["supply-chain", "lodash"],
        metadata: { package: "lodash", version: "4.17.20" }
      }
    ],
    vulnerabilities: [{ id: "lodash-4.17.20" }]
  });

  try {
    const response = await request(app)
      .post(`/api/supplychain/scan/${engagement._id}`)
      .set(authHeaders());
    assert.equal(response.status, 200);
    assert.equal(response.body.count, 1);

    const job = await ExecutionJob.findOne({
      engagementId: engagement._id,
      toolId: "supply_chain_scan"
    }).lean();
    assert.ok(job);
    assert.equal(job.status, "success");
    assert.equal(job.findings.length, 1);
  } finally {
    supplyChainService.scanEngagement = originalScan;
  }
});

test("GET /api/supplychain/:engagementId returns findings", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Supply route GET"));
  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "supply_chain_scan",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "dep-1",
        severity: "high",
        category: "Supply Chain",
        title: "express vulnerable",
        description: "express vulnerable dependency",
        recommendation: "Upgrade",
        source: "supply_chain",
        cve: "CVE-2022-24999",
        tags: ["supply-chain"]
      }
    ]
  });

  const response = await request(app)
    .get(`/api/supplychain/${engagement._id}`)
    .set(authHeaders());

  assert.equal(response.status, 200);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.high, 1);
});
