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
const reportGeneratorService = require("../../services/reportGeneratorService");

const app = createApp();

function authHeaders() {
  return {
    "x-api-key": "test-key",
    "x-user-id": "tester@example.com",
    "x-user-role": "admin"
  };
}

function buildEngagementPayload(name = "Report Generation Test") {
  return {
    name,
    targetUrl: "https://example.com",
    targetType: "website",
    authorization: {
      engagementId: "eng-report",
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

test("generateReport builds What/How/What Found/Why/Fix structure", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Hardened report service"));

  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "secrets_scan",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "secret-1",
        severity: "critical",
        type: "SECRET_FOUND",
        category: "Secrets Exposure",
        title: "Exposed API key detected",
        description: "API key found in config",
        recommendation: "Rotate API key immediately",
        source: "secrets_detection",
        evidence: "api_key=abcd1234",
        tags: ["secrets"]
      }
    ]
  });

  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "supply_chain_scan",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "dep-1",
        severity: "high",
        type: "VULNERABLE_DEPENDENCY",
        category: "Supply Chain",
        title: "lodash vulnerable",
        description: "lodash@4.17.20 linked to known CVE",
        recommendation: "Upgrade lodash",
        source: "supply_chain",
        cve: "CVE-2021-23337",
        tags: ["supply-chain", "lodash"]
      }
    ]
  });

  const report = await reportGeneratorService.generateReport(engagement._id);
  assert.equal(report.findingsSummary.critical, 1);
  assert.equal(report.findingsSummary.high, 1);
  assert.ok(Array.isArray(report.findings));
  assert.ok(report.findings.length >= 2);

  const first = report.findings[0];
  assert.ok(first.what);
  assert.ok(first.how);
  assert.ok(first.whatFound);
  assert.ok(first.why);
  assert.ok(first.fix);
});

test("GET /api/reports/:engagementId/hardened returns structured report", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Hardened report route"));
  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "cloud_misconfig_scan",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "cloud-1",
        severity: "high",
        type: "CLOUD_MISCONFIGURATION",
        category: "Cloud Configuration",
        title: "Security group open to world",
        description: "0.0.0.0/0 on sensitive port",
        recommendation: "Restrict ingress CIDRs",
        source: "cloud_misconfiguration"
      }
    ]
  });

  const response = await request(app)
    .get(`/api/reports/${engagement._id}/hardened`)
    .set(authHeaders());

  assert.equal(response.status, 200);
  assert.equal(response.body.engagementId, String(engagement._id));
  assert.ok(Array.isArray(response.body.findings));
  assert.ok(response.body.findings[0].what);
  assert.ok(response.body.findings[0].fix);
});
