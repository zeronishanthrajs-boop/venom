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
const secretsDetectionService = require("../../services/secretsDetectionService");

const app = createApp();

function authHeaders() {
  return {
    "x-api-key": "test-key",
    "x-user-id": "tester@example.com",
    "x-user-role": "admin"
  };
}

function buildEngagementPayload(name = "Secrets Test") {
  return {
    name,
    targetUrl: "https://github.com/public/repo",
    targetType: "website",
    authorization: {
      engagementId: "eng-secrets",
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

test("matchPatterns detects AWS keys", () => {
  const content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
  const matches = secretsDetectionService.matchPatterns(content, "config.js");
  assert.ok(matches.length > 0);
  assert.equal(matches[0].type, "AWS_KEY");
});

test("matchPatterns detects GitHub tokens", () => {
  const content = "GITHUB_TOKEN=ghp_abcd1234efgh5678ijkl9012mnop3456qrst";
  const matches = secretsDetectionService.matchPatterns(content, ".env");
  assert.ok(matches.some((item) => item.type === "GITHUB_TOKEN"));
});

test("scanEngagement returns normalized findings", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Secrets scan normalization"));

  const originalGitHub = secretsDetectionService.scanGitHub;
  const originalConfigs = secretsDetectionService.scanCommonConfigs;
  const originalEnv = secretsDetectionService.scanEnvironmentFiles;

  secretsDetectionService.scanGitHub = async () => [
    {
      type: "API_KEY",
      location: "github:file",
      partial: "abcd****",
      evidence: "api_key=abcd1234efgh5678ijkl9012",
      severity: "critical"
    }
  ];
  secretsDetectionService.scanCommonConfigs = async () => [];
  secretsDetectionService.scanEnvironmentFiles = async () => [];

  try {
    const result = await secretsDetectionService.scanEngagement(engagement._id);
    assert.ok(Array.isArray(result.findings));
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, "SECRET_FOUND");
    assert.equal(result.findings[0].severity, "critical");
  } finally {
    secretsDetectionService.scanGitHub = originalGitHub;
    secretsDetectionService.scanCommonConfigs = originalConfigs;
    secretsDetectionService.scanEnvironmentFiles = originalEnv;
  }
});

test("getRemediation returns AWS guidance", () => {
  const remediation = secretsDetectionService.getRemediation("AWS_KEY");
  assert.match(remediation, /AWS/i);
});

test("POST /api/secrets/scan/:engagementId stores execution job", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Secrets route POST"));
  const originalScan = secretsDetectionService.scanEngagement;
  secretsDetectionService.scanEngagement = async () => ({
    findings: [
      {
        id: "secret-1",
        type: "SECRET_FOUND",
        severity: "critical",
        category: "Secrets Exposure",
        title: "Exposed API key detected",
        description: "Potential API key was detected in .env",
        recommendation: "Rotate credential",
        source: "secrets_detection",
        tags: ["secrets"],
        metadata: { location: ".env" }
      }
    ]
  });

  try {
    const response = await request(app)
      .post(`/api/secrets/scan/${engagement._id}`)
      .set(authHeaders());
    assert.equal(response.status, 200);
    assert.equal(response.body.count, 1);

    const job = await ExecutionJob.findOne({
      engagementId: engagement._id,
      toolId: "secrets_scan"
    }).lean();
    assert.ok(job);
    assert.equal(job.status, "success");
    assert.equal(job.findings.length, 1);
  } finally {
    secretsDetectionService.scanEngagement = originalScan;
  }
});

test("GET /api/secrets/:engagementId returns secret findings", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Secrets route GET"));
  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "secrets_scan",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "secret-1",
        severity: "critical",
        category: "Secrets Exposure",
        title: "Exposed token",
        description: "Token exposed in env file",
        recommendation: "Rotate key",
        source: "secrets_detection",
        tags: ["secrets"]
      }
    ]
  });

  const response = await request(app)
    .get(`/api/secrets/${engagement._id}`)
    .set(authHeaders());

  assert.equal(response.status, 200);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.critical, 1);
});
