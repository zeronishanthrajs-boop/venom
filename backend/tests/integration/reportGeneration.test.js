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
const ExecutionLog = require("../../models/ExecutionLog");
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
  await Promise.all([
    Engagement.deleteMany({}),
    ExecutionJob.deleteMany({}),
    ExecutionLog.deleteMany({})
  ]);
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

test("generateDetailedReport includes execution summary and trace details", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Detailed report service"));
  const testId = "test-csp-001";

  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "http_headers_probe",
    targetUrl: engagement.targetUrl,
    status: "success",
    durationMs: 284,
    findings: [
      {
        id: "header-1",
        severity: "medium",
        type: "MISCONFIGURATION",
        category: "Security Headers",
        title: "Missing Content-Security-Policy Header",
        description: "Response did not include a CSP header.",
        recommendation: "Define a least-privilege CSP policy.",
        source: "http_headers_probe",
        metadata: {
          testId,
          executionTestId: testId,
          executionTestName: "CSP Header Check",
          targetUrl: engagement.targetUrl
        }
      }
    ]
  });

  await ExecutionLog.create({
    engagementId: engagement._id,
    testId,
    testName: "CSP Header Check",
    tool: "http_headers_probe",
    category: "Security Headers",
    target: engagement.targetUrl,
    parameters: {
      method: "GET",
      url: engagement.targetUrl,
      headers: {
        "User-Agent": "VENOM/0.8"
      }
    },
    response: {
      statusCode: 200,
      headers: {
        "x-content-type-options": "nosniff"
      },
      bodySize: 5120
    },
    result: {
      status: "VULNERABLE",
      confidence: 0.95,
      reason: "CSP header absent from response",
      severity: "medium"
    },
    executionTimeMs: 284,
    findingCount: 1
  });

  await ExecutionLog.create({
    engagementId: engagement._id,
    testId: "test-sqli-001",
    testName: "SQL Injection Probe",
    tool: "sqlmap_detect",
    category: "Injection and Vulnerability",
    target: engagement.targetUrl,
    result: {
      status: "PASSED",
      confidence: 0.9,
      reason: "No injectable parameters detected.",
      severity: "low"
    },
    executionTimeMs: 1200,
    findingCount: 0
  });

  const report = await reportGeneratorService.generateDetailedReport(engagement._id);

  assert.equal(report.structureVersion, "phase1.5.v1");
  assert.equal(report.executionDetails.totalTests, 2);
  assert.equal(report.executionDetails.failed, 1);
  assert.equal(report.executionDetails.passed, 1);
  assert.ok(Array.isArray(report.detailedFindings));
  assert.ok(report.detailedFindings.length >= 1);
  assert.equal(report.detailedFindings[0].executionTrace.test.id, testId);
  assert.equal(
    report.detailedFindings[0].executionTrace.result.status,
    "VULNERABLE"
  );
  assert.ok(Array.isArray(report.detailedFindings[0].reproductionSteps));
});

test("GET /api/reports/:engagementId/detailed-with-execution returns execution details", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Detailed report route"));

  await ExecutionLog.create({
    engagementId: engagement._id,
    testId: "test-cors-001",
    testName: "CORS Misconfiguration Check",
    tool: "http_headers_probe",
    category: "Security Headers",
    target: engagement.targetUrl,
    result: {
      status: "PASSED",
      confidence: 0.92,
      reason: "Origin restrictions validated.",
      severity: "low"
    },
    executionTimeMs: 320,
    findingCount: 0
  });

  const response = await request(app)
    .get(`/api/reports/${engagement._id}/detailed-with-execution`)
    .set(authHeaders());

  assert.equal(response.status, 200);
  assert.equal(response.body.structureVersion, "phase1.5.v1");
  assert.ok(response.body.executionDetails);
  assert.equal(response.body.executionDetails.totalTests, 1);
  assert.ok(Array.isArray(response.body.passedTests));
});
