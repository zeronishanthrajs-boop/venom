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
const ExecutionLog = require("../../models/ExecutionLog");
const containerSecurityService = require("../../services/containerSecurityService");

const app = createApp();
const validId = "507f1f77bcf86cd799439011";

function buildEngagementPayload(name = "Container Security Test", targetUrl = "https://example.com") {
  return {
    name,
    targetUrl,
    targetType: "website",
    authorization: {
      engagementId: "eng-container",
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
  await Promise.all([Engagement.deleteMany({}), ExecutionLog.deleteMany({})]);
});

test("POST /api/container/scan/:engagementId requires auth", async () => {
  const response = await request(app).post(`/api/container/scan/${validId}`);
  assert.equal(response.status, 401);
});

test("GET /api/container/:engagementId requires auth", async () => {
  const response = await request(app).get(`/api/container/${validId}`);
  assert.equal(response.status, 401);
});

test("vulnerable image map flags node:14 as critical", () => {
  const vulnerable = containerSecurityService.getKnownVulnerableImage("node:14");
  assert.ok(vulnerable);
  assert.equal(vulnerable.severity, "critical");
});

test("scanDockerfileContent detects missing USER directive", () => {
  const dockerfile = `
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci
CMD ["npm","start"]
`;
  const result = containerSecurityService.scanDockerfileContent(dockerfile, "Dockerfile");
  const missingUser = result.findings.find(
    (item) => item.type === "CONTAINER_USER_MISSING"
  );
  assert.ok(missingUser);
  assert.equal(missingUser.severity, "high");
});

test("scanComposeContent flags privileged mode", () => {
  const compose = `
version: '3.8'
services:
  app:
    image: node:20
    privileged: true
`;
  const result = containerSecurityService.scanComposeContent(compose, "docker-compose.yml");
  const privileged = result.findings.find(
    (item) => item.type === "CONTAINER_PRIVILEGED_MODE"
  );
  assert.ok(privileged);
  assert.equal(privileged.severity, "critical");
});

test("scanEngagement returns empty findings when target is not a GitHub URL", async () => {
  const engagement = await Engagement.create(
    buildEngagementPayload("Non-GitHub target", "https://api.example.com")
  );
  const result = await containerSecurityService.scanEngagement(engagement._id);
  assert.ok(Array.isArray(result.findings));
  assert.equal(result.findings.length, 0);
});
