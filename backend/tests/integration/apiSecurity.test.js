const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.VENOM_API_KEY = process.env.VENOM_API_KEY || "test-key";
process.env.VALID_API_KEYS = process.env.VALID_API_KEYS || "test-key";
process.env.ENABLE_INMEMORY_DB = "true";
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_MAX = "10000";

const { createApp } = require("../../app");
const apiSecurityService = require("../../services/apiSecurityService");

const app = createApp();
const validId = "507f1f77bcf86cd799439011";

test("POST /api/apis/scan/:engagementId requires auth", async () => {
  const response = await request(app).post(`/api/apis/scan/${validId}`);
  assert.equal(response.status, 401);
});

test("GET /api/apis/:engagementId requires auth", async () => {
  const response = await request(app).get(`/api/apis/${validId}`);
  assert.equal(response.status, 401);
});

test("runBolaTest identifies BOLA when incremented ID returns PII", async () => {
  const originalSafeRequest = apiSecurityService.safeRequest;
  const originalLogApiTest = apiSecurityService.logApiTest;
  apiSecurityService.safeRequest = async () => ({
    ok: true,
    status: 200,
    headers: {},
    body: {
      email: "victim@example.com",
      token: "abc123"
    },
    durationMs: 12
  });
  apiSecurityService.logApiTest = async () => null;

  try {
    const finding = await apiSecurityService.runBolaTest(
      "https://example.com",
      { path: "/api/users/1", method: "GET" },
      null
    );
    assert.ok(finding);
    assert.equal(finding.type, "API_BROKEN_OBJECT_LEVEL_AUTHORIZATION");
    assert.equal(finding.severity, "critical");
  } finally {
    apiSecurityService.safeRequest = originalSafeRequest;
    apiSecurityService.logApiTest = originalLogApiTest;
  }
});

test("runRateLimitTest identifies missing rate limiting when 20 requests succeed", async () => {
  const originalSafeRequest = apiSecurityService.safeRequest;
  const originalLogApiTest = apiSecurityService.logApiTest;
  apiSecurityService.safeRequest = async () => ({
    ok: true,
    status: 200,
    headers: {},
    body: { ok: true },
    durationMs: 5
  });
  apiSecurityService.logApiTest = async () => null;

  try {
    const finding = await apiSecurityService.runRateLimitTest(
      "https://example.com",
      { path: "/api/login", method: "POST" },
      null
    );
    assert.ok(finding);
    assert.equal(finding.type, "API_MISSING_RATE_LIMIT");
    assert.equal(finding.severity, "high");
    assert.equal(finding.metadata.requestCount, 20);
  } finally {
    apiSecurityService.safeRequest = originalSafeRequest;
    apiSecurityService.logApiTest = originalLogApiTest;
  }
});

test("parseOpenApiSpec extracts endpoint count from OpenAPI object", () => {
  const sampleSpec = {
    openapi: "3.0.0",
    paths: {
      "/api/users": {
        get: {},
        post: {}
      },
      "/api/users/{id}": {
        get: {}
      }
    }
  };

  const endpoints = apiSecurityService.parseOpenApiSpec(sampleSpec);
  assert.equal(endpoints.length, 3);
});

test("checkGraphQLIntrospection flags exposed schema introspection", async () => {
  const originalSafeRequest = apiSecurityService.safeRequest;
  const originalLogApiTest = apiSecurityService.logApiTest;
  apiSecurityService.safeRequest = async () => ({
    ok: true,
    status: 200,
    headers: {},
    body: {
      data: {
        __schema: {
          types: [{ name: "Query" }]
        }
      }
    },
    durationMs: 9
  });
  apiSecurityService.logApiTest = async () => null;

  try {
    const finding = await apiSecurityService.checkGraphQLIntrospection(
      "https://example.com"
    );
    assert.ok(finding);
    assert.equal(finding.type, "API_GRAPHQL_INTROSPECTION_ENABLED");
    assert.equal(finding.severity, "medium");
  } finally {
    apiSecurityService.safeRequest = originalSafeRequest;
    apiSecurityService.logApiTest = originalLogApiTest;
  }
});
