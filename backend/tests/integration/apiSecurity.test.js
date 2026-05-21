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
    assert.ok(finding.evidence);
    assert.ok(String(finding.discoveryVector || "").includes("BOLA probe"));
    assert.ok(Array.isArray(finding.reproductionSteps));
    assert.ok(String(finding.reproductionSteps[0] || "").includes("curl"));
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
    assert.ok(finding.evidence?.rateLimitProbe);
    assert.ok(String(finding.discoveryVector || "").includes("Rate limit probe"));
    assert.ok(Array.isArray(finding.reproductionSteps));
    assert.ok(String(finding.reproductionSteps[0] || "").includes("curl"));
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

test("discoverEndpoints only queues valid endpoint statuses and excludes static assets", async () => {
  const originalSafeRequest = apiSecurityService.safeRequest;
  apiSecurityService.safeRequest = async ({ url, method = "GET" }) => {
    const parsed = new URL(url);
    const key = `${String(method).toUpperCase()}:${parsed.pathname}${parsed.search || ""}`;
    const table = {
      "GET:/openapi.json": { ok: true, status: 404, headers: {}, body: "", durationMs: 2 },
      "GET:/swagger.json": { ok: true, status: 404, headers: {}, body: "", durationMs: 2 },
      "GET:/api-docs": { ok: true, status: 404, headers: {}, body: "", durationMs: 2 },
      "GET:/v3/api-docs": { ok: true, status: 404, headers: {}, body: "", durationMs: 2 },
      "GET:/": {
        ok: true,
        status: 200,
        headers: {},
        body: "<a href='/api/users'>users</a><a href='/assets/app.js'>bundle</a><a href='/_next/static/chunk.js'>next</a>",
        durationMs: 5
      },
      "GET:/api/users": { ok: true, status: 401, headers: {}, body: "", durationMs: 4 },
      "GET:/api/login": { ok: true, status: 405, headers: {}, body: "", durationMs: 4 },
      "GET:/index.php": { ok: true, status: 410, headers: {}, body: "", durationMs: 4 },
      "GET:/product.php?id=1": { ok: true, status: 500, headers: {}, body: "", durationMs: 4 }
    };
    return table[key] || {
      ok: true,
      status: 404,
      headers: {},
      body: "",
      durationMs: 3
    };
  };

  try {
    const result = await apiSecurityService.discoverEndpoints("https://example.com");
    const endpointPaths = result.endpoints.map((item) => item.path);
    assert.ok(endpointPaths.includes("/"));
    assert.ok(endpointPaths.includes("/api/users"));
    assert.ok(endpointPaths.includes("/api/login"));
    assert.ok(!endpointPaths.some((path) => path.endsWith(".js")));
    assert.ok(!endpointPaths.some((path) => path.includes("/_next/")));
    assert.ok(
      result.discoveryAudit.some((item) => String(item.message || "").includes("Target responded 404"))
    );
    assert.ok(
      result.scanLimitations.some((item) => String(item.reason || "").includes("Target responded 500"))
    );
  } finally {
    apiSecurityService.safeRequest = originalSafeRequest;
  }
});

test("discoverEndpoints records connection failures as scan limitations", async () => {
  const originalSafeRequest = apiSecurityService.safeRequest;
  apiSecurityService.safeRequest = async ({ url, method = "GET" }) => {
    const parsed = new URL(url);
    const key = `${String(method).toUpperCase()}:${parsed.pathname}${parsed.search || ""}`;
    if (key === "GET:/openapi.json" || key === "GET:/swagger.json" || key === "GET:/api-docs" || key === "GET:/v3/api-docs") {
      return { ok: true, status: 404, headers: {}, body: "", durationMs: 2 };
    }
    if (key === "GET:/") {
      return {
        ok: true,
        status: 200,
        headers: {},
        body: "<a href='/api/users'>users</a>",
        durationMs: 5
      };
    }
    if (key === "GET:/api/users") {
      return {
        ok: false,
        status: 0,
        headers: {},
        body: null,
        durationMs: 15,
        error: "connect ECONNREFUSED",
        errorCode: "ECONNREFUSED"
      };
    }
    return { ok: true, status: 404, headers: {}, body: "", durationMs: 2 };
  };

  try {
    const result = await apiSecurityService.discoverEndpoints("https://example.com");
    assert.ok(
      result.scanLimitations.some((item) =>
        String(item.reason || "").includes("Connection failed before response")
      )
    );
    assert.ok(!result.endpoints.some((item) => item.path === "/api/users"));
  } finally {
    apiSecurityService.safeRequest = originalSafeRequest;
  }
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
    assert.ok(finding.evidence);
    assert.ok(String(finding.discoveryVector || "").includes("GraphQL probe"));
    assert.ok(Array.isArray(finding.reproductionSteps));
    assert.ok(String(finding.reproductionSteps[0] || "").includes("curl"));
  } finally {
    apiSecurityService.safeRequest = originalSafeRequest;
    apiSecurityService.logApiTest = originalLogApiTest;
  }
});
