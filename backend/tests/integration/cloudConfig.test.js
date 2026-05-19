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
const cloudMisconfigService = require("../../services/cloudMisconfigService");

const app = createApp();

function authHeaders() {
  return {
    "x-api-key": "test-key",
    "x-user-id": "tester@example.com",
    "x-user-role": "admin"
  };
}

function buildEngagementPayload(name = "Cloud Config Test") {
  return {
    name,
    targetUrl: "https://example.com",
    targetType: "website",
    authorization: {
      engagementId: "eng-cloud",
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

test("checkSecurityGroups flags open 0.0.0.0/0 rules", async () => {
  const mockEc2Client = {
    describeSecurityGroups() {
      return {
        promise: async () => ({
          SecurityGroups: [
            {
              GroupId: "sg-123",
              IpPermissions: [
                {
                  FromPort: 3306,
                  ToPort: 3306,
                  IpRanges: [{ CidrIp: "0.0.0.0/0" }]
                }
              ]
            }
          ]
        })
      };
    }
  };

  const findings = await cloudMisconfigService.checkSecurityGroups(mockEc2Client);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "CLOUD_MISCONFIGURATION");
  assert.equal(findings[0].severity, "critical");
});

test("POST /api/cloudconfig/scan/:engagementId stores execution job", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Cloud route POST"));
  const originalScan = cloudMisconfigService.scanAWSAccount;
  cloudMisconfigService.scanAWSAccount = async () => [
    {
      id: "cloud-1",
      type: "CLOUD_MISCONFIGURATION",
      severity: "critical",
      category: "Cloud Configuration",
      title: "S3 bucket is publicly accessible",
      description: "Public ACL found",
      remediation: "Disable public access",
      source: "cloud_misconfiguration",
      tags: ["cloud", "aws", "s3"]
    }
  ];

  try {
    const response = await request(app)
      .post(`/api/cloudconfig/scan/${engagement._id}`)
      .set(authHeaders())
      .send({ region: "us-east-1" });
    assert.equal(response.status, 200);
    assert.equal(response.body.count, 1);

    const job = await ExecutionJob.findOne({
      engagementId: engagement._id,
      toolId: "cloud_misconfig_scan"
    }).lean();
    assert.ok(job);
    assert.equal(job.status, "success");
    assert.equal(job.findings.length, 1);
  } finally {
    cloudMisconfigService.scanAWSAccount = originalScan;
  }
});

test("GET /api/cloudconfig/:engagementId returns findings", async () => {
  const engagement = await Engagement.create(buildEngagementPayload("Cloud route GET"));
  await ExecutionJob.create({
    engagementId: engagement._id,
    toolId: "cloud_misconfig_scan",
    targetUrl: engagement.targetUrl,
    status: "success",
    findings: [
      {
        id: "cloud-1",
        severity: "high",
        category: "Cloud Configuration",
        title: "Open ingress",
        description: "Security group exposed",
        recommendation: "Restrict ingress",
        source: "cloud_misconfiguration",
        tags: ["cloud"]
      }
    ]
  });

  const response = await request(app)
    .get(`/api/cloudconfig/${engagement._id}`)
    .set(authHeaders());

  assert.equal(response.status, 200);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.high, 1);
});
