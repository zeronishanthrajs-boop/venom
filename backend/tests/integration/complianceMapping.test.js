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
const complianceMapperService = require("../../services/complianceMapperService");

const app = createApp();

function authHeaders() {
  return {
    "x-api-key": "test-key",
    "x-user-id": "tester@example.com",
    "x-user-role": "admin"
  };
}

function buildEngagementPayload(name = "Compliance Mapping Test") {
  return {
    name,
    targetUrl: "https://example.com",
    targetType: "website",
    authorization: {
      engagementId: "eng-compliance",
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

test("SQL injection finding maps to OWASP A03:2021", () => {
  const mapped = complianceMapperService.mapFinding({
    type: "SQL_INJECTION",
    title: "SQL injection on login endpoint",
    severity: "high"
  });
  assert.ok(mapped.compliance);
  assert.ok(mapped.compliance.owasp.some((item) => item.code === "A03:2021"));
});

test("BOLA finding maps to OWASP A01:2021 and PCI-DSS 7.2", () => {
  const mapped = complianceMapperService.mapFinding({
    type: "API_BROKEN_OBJECT_LEVEL_AUTHORIZATION",
    title: "BOLA on /api/users/2",
    severity: "critical"
  });
  assert.ok(mapped.compliance.owasp.some((item) => item.code === "A01:2021"));
  assert.ok(mapped.compliance.pciDss.some((item) => item.requirement === "7.2"));
});

test("SECRET_FOUND maps to A02:2021, PCI-DSS 3.5, and HIPAA §164.312", () => {
  const mapped = complianceMapperService.mapFinding({
    type: "SECRET_FOUND",
    title: "Exposed API secret in config",
    severity: "critical"
  });
  assert.ok(mapped.compliance.owasp.some((item) => item.code === "A02:2021"));
  assert.ok(mapped.compliance.pciDss.some((item) => item.requirement === "3.5"));
  assert.ok(
    mapped.compliance.hipaa.some((item) => String(item.reference || "").startsWith("§164.312"))
  );
});

test("generateComplianceReport returns CRITICAL risk when critical findings exist", () => {
  const report = complianceMapperService.generateComplianceReport([
    { type: "SQL_INJECTION", severity: "critical", title: "SQLi-1" },
    { type: "SECRET_FOUND", severity: "critical", title: "Secret-1" },
    { type: "API_BROKEN_OBJECT_LEVEL_AUTHORIZATION", severity: "critical", title: "BOLA-1" }
  ]);
  assert.equal(report.overallRisk, "CRITICAL");
});

test("generateComplianceReport returns 100% CIS score for zero findings", () => {
  const report = complianceMapperService.generateComplianceReport([]);
  assert.equal(report.cis.scorePercent, 100);
  assert.equal(report.cis.passedControls, 7);
  assert.equal(report.cis.failedControls, 0);
});

test("hardened report output includes compliance section when engagement has complianceReport", async () => {
  const engagement = await Engagement.create({
    ...buildEngagementPayload("Compliance section in report"),
    complianceReport: {
      overallRisk: "HIGH",
      summary: "Compliance posture requires remediation."
    }
  });

  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "api_security_scan",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "api-1",
        severity: "high",
        category: "API Security",
        title: "Unauthenticated endpoint",
        description: "Endpoint responded without auth",
        recommendation: "Add auth middleware",
        source: "api_security",
        tags: ["api-security"]
      }
    ]
  });

  const response = await request(app)
    .get(`/api/reports/${engagement._id}/hardened`)
    .set(authHeaders());

  assert.equal(response.status, 200);
  assert.ok(response.body.compliance);
  assert.equal(response.body.compliance.summary, "Compliance posture requires remediation.");
});
