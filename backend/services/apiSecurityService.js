const axios = require("axios");
const Engagement = require("../models/Engagement");
const executionLoggerService = require("./executionLoggerService");
const { logger } = require("../config/logger");

const API_SPEC_PATHS = ["/openapi.json", "/swagger.json", "/api-docs", "/v3/api-docs"];
const COMMON_API_PATHS = [
  "/api",
  "/api/v1",
  "/api/users",
  "/api/admin",
  "/api/products",
  "/api/login"
];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const PII_HINTS = ["email", "phone", "password", "token", "ssn", "address", "dob"];

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asString(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function looksLikeHttpUrl(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizePath(pathValue) {
  const raw = String(pathValue || "").trim();
  if (!raw) {
    return "/";
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const parsed = new URL(raw);
      return parsed.pathname || "/";
    } catch {
      return "/";
    }
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function joinUrl(baseUrl, endpointPath) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const path = normalizePath(endpointPath);
  return `${base}${path}`;
}

function buildTestId(prefix) {
  return `test-api-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

class ApiSecurityService {
  constructor(httpClient = axios, executionLogger = executionLoggerService) {
    this.httpClient = httpClient;
    this.executionLogger = executionLogger;
  }

  parseOpenApiSpec(spec = {}) {
    const parsed = asObject(spec);
    const paths = asObject(parsed.paths);
    const endpoints = [];

    for (const [rawPath, definition] of Object.entries(paths)) {
      const pathItem = asObject(definition);
      for (const method of HTTP_METHODS) {
        const key = method.toLowerCase();
        if (pathItem[key]) {
          endpoints.push({
            path: normalizePath(rawPath),
            method,
            source: "openapi"
          });
        }
      }
    }

    return endpoints;
  }

  deduplicateEndpoints(endpoints = []) {
    const seen = new Set();
    const deduped = [];
    for (const endpoint of endpoints) {
      const path = normalizePath(endpoint.path);
      const method = String(endpoint.method || "GET").toUpperCase();
      const key = `${method}:${path}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push({
        path,
        method,
        source: endpoint.source || "probe"
      });
    }
    return deduped;
  }

  async safeRequest({
    url,
    method = "GET",
    headers = {},
    data = undefined,
    timeout = 6000
  }) {
    const startedAt = Date.now();
    try {
      const response = await this.httpClient.request({
        url,
        method,
        headers,
        data,
        timeout,
        maxRedirects: 2,
        validateStatus: () => true
      });
      return {
        ok: true,
        status: Number(response.status || 0),
        headers: asObject(response.headers),
        body: response.data,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        headers: {},
        body: null,
        durationMs: Date.now() - startedAt,
        error: error?.message || "request failed"
      };
    }
  }

  async discoverEndpoints(targetUrl) {
    const endpoints = [];
    if (!looksLikeHttpUrl(targetUrl)) {
      return endpoints;
    }

    for (const specPath of API_SPEC_PATHS) {
      const specResponse = await this.safeRequest({
        url: joinUrl(targetUrl, specPath),
        method: "GET"
      });
      if (specResponse.status < 200 || specResponse.status >= 300) {
        continue;
      }
      const parsed =
        typeof specResponse.body === "string"
          ? (() => {
              try {
                return JSON.parse(specResponse.body);
              } catch {
                return {};
              }
            })()
          : asObject(specResponse.body);
      const specEndpoints = this.parseOpenApiSpec(parsed);
      if (specEndpoints.length > 0) {
        return this.deduplicateEndpoints(specEndpoints);
      }
    }

    for (const path of COMMON_API_PATHS) {
      const headResp = await this.safeRequest({
        url: joinUrl(targetUrl, path),
        method: "HEAD"
      });
      if (headResp.status > 0 && headResp.status !== 404) {
        endpoints.push({ path, method: "HEAD", source: "probe" });
        continue;
      }

      const getResp = await this.safeRequest({
        url: joinUrl(targetUrl, path),
        method: "GET"
      });
      if (getResp.status > 0 && getResp.status !== 404) {
        endpoints.push({ path, method: "GET", source: "probe" });
      }
    }

    return this.deduplicateEndpoints(endpoints);
  }

  materializePath(path) {
    const normalized = normalizePath(path);
    return normalized.replace(/\{[^/}]+\}/g, "1");
  }

  incrementEndpointId(path) {
    const materialized = this.materializePath(path);
    const segments = materialized.split("/");
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (!/^\d+$/.test(segments[index])) {
        continue;
      }
      segments[index] = String(Number.parseInt(segments[index], 10) + 1);
      return segments.join("/");
    }
    return null;
  }

  containsSensitiveData(body) {
    const serialized = asString(body).toLowerCase();
    return PII_HINTS.some((field) => serialized.includes(field));
  }

  buildFinding({
    idPrefix = "api",
    type,
    title,
    description,
    severity,
    endpoint,
    methodTested,
    testPerformed,
    responseObserved,
    remediation
  }) {
    return {
      id: `${idPrefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      type,
      severity,
      category: "API Security",
      title,
      description,
      recommendation: remediation,
      remediation,
      source: "api_security",
      endpoint,
      methodTested,
      testPerformed,
      responseObserved,
      tags: ["api-security", String(type || "").toLowerCase()],
      metadata: {
        findingType: type,
        endpoint,
        methodTested,
        testPerformed,
        responseObserved
      }
    };
  }

  async logApiTest({
    engagementId,
    testName,
    endpoint,
    method,
    parameters,
    response,
    finding = null,
    durationMs = 0
  }) {
    if (!engagementId) {
      return;
    }
    const statusCode = Number(response?.status || 0);
    const resultStatus = finding ? "VULNERABLE" : "PASSED";
    await this.executionLogger.logTestExecution({
      engagementId,
      testId: buildTestId(String(testName || "check").toLowerCase().replace(/\s+/g, "-")),
      testName,
      tool: "VENOM API Scanner",
      category: "API Security",
      target: endpoint,
      parameters: {
        endpoint,
        method,
        ...(parameters || {})
      },
      response: {
        statusCode,
        headers: response?.headers || {},
        bodySize: asString(response?.body).length
      },
      result: {
        status: resultStatus,
        confidence: finding ? 0.9 : 0.85,
        reason: finding
          ? String(finding.title || "Potential API vulnerability detected.")
          : "No vulnerability signal detected.",
        severity: finding?.severity || "low"
      },
      executionTimeMs: durationMs,
      findingCount: finding ? 1 : 0
    });
  }

  async runMissingAuthTest(targetUrl, endpoint, engagementId) {
    const requestPath = this.materializePath(endpoint.path);
    const response = await this.safeRequest({
      url: joinUrl(targetUrl, requestPath),
      method: endpoint.method === "HEAD" ? "GET" : endpoint.method,
      headers: {}
    });
    const isApiPath = requestPath.toLowerCase().includes("/api");
    const vulnerable = response.status === 200 && isApiPath;
    const finding = vulnerable
      ? this.buildFinding({
          type: "API_MISSING_AUTHENTICATION",
          title: `Unauthenticated endpoint exposed: ${requestPath}`,
          description:
            "Endpoint accepted request without Authorization header or API key.",
          severity: "high",
          endpoint: requestPath,
          methodTested: endpoint.method,
          testPerformed: "Sent request without Authorization or API key headers.",
          responseObserved: `HTTP ${response.status}`,
          remediation:
            "Add authentication middleware (e.g., auth guard) before this route and enforce token/API-key validation."
        })
      : null;

    await this.logApiTest({
      engagementId,
      testName: "Missing Authentication Check",
      endpoint: joinUrl(targetUrl, requestPath),
      method: endpoint.method,
      parameters: {
        check: "missing_authentication",
        headersSent: "none",
        credentialsSent: "none"
      },
      response,
      finding,
      durationMs: response.durationMs
    });

    return finding;
  }

  async runBolaTest(targetUrl, endpoint, engagementId) {
    const originalPath = this.materializePath(endpoint.path);
    const incrementedPath = this.incrementEndpointId(endpoint.path);
    if (!incrementedPath) {
      return null;
    }

    const response = await this.safeRequest({
      url: joinUrl(targetUrl, incrementedPath),
      method: endpoint.method === "HEAD" ? "GET" : endpoint.method,
      headers: {}
    });
    const vulnerable = response.status === 200 && this.containsSensitiveData(response.body);
    const finding = vulnerable
      ? this.buildFinding({
          type: "API_BROKEN_OBJECT_LEVEL_AUTHORIZATION",
          title: `Potential BOLA on ${originalPath}`,
          description:
            "Incremented resource identifier returned accessible sensitive data, indicating missing ownership validation.",
          severity: "critical",
          endpoint: incrementedPath,
          methodTested: endpoint.method,
          testPerformed: `Changed object identifier from ${originalPath} to ${incrementedPath} and replayed request.`,
          responseObserved: `HTTP ${response.status} with sensitive fields in response body.`,
          remediation:
            "Validate object ownership before returning data by comparing the authenticated user ID to the resource owner ID."
        })
      : null;

    await this.logApiTest({
      engagementId,
      testName: "BOLA Check",
      endpoint: joinUrl(targetUrl, incrementedPath),
      method: endpoint.method,
      parameters: {
        check: "bola",
        originalPath,
        incrementedPath
      },
      response,
      finding,
      durationMs: response.durationMs
    });

    return finding;
  }

  async runRateLimitTest(targetUrl, endpoint, engagementId) {
    const requestPath = this.materializePath(endpoint.path);
    const requestMethod = endpoint.method === "HEAD" ? "GET" : endpoint.method;
    const requestCount = 20;
    const responses = [];
    const startedAt = Date.now();
    for (let index = 0; index < requestCount; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.safeRequest({
        url: joinUrl(targetUrl, requestPath),
        method: requestMethod
      });
      responses.push(response);
    }
    const totalDuration = Date.now() - startedAt;
    const first429Index = responses.findIndex((item) => item.status === 429);
    const successfulResponses = responses.filter(
      (item) => item.status >= 200 && item.status < 300
    ).length;
    const successfulBeforeThrottle =
      first429Index === -1
        ? successfulResponses
        : responses
            .slice(0, first429Index)
            .filter((item) => item.status >= 200 && item.status < 300).length;
    const representative = responses[0] || {
      status: 0,
      body: null,
      headers: {},
      durationMs: totalDuration
    };
    const finding =
      first429Index === -1 && successfulResponses === requestCount
        ? this.buildFinding({
          type: "API_MISSING_RATE_LIMIT",
          title: `No rate limiting detected on ${requestPath}`,
          description: `${requestCount} sequential rapid requests were accepted without throttling.`,
          severity: "high",
          endpoint: requestPath,
          methodTested: requestMethod,
          testPerformed: `Executed ${requestCount} sequential rapid unauthenticated requests.`,
          responseObserved: `No HTTP 429 responses. ${requestCount}/${requestCount} requests succeeded in ${totalDuration}ms.`,
          remediation:
            "Apply request throttling (for example: 60 requests/minute for public endpoints and 20 requests/minute for authenticated/session endpoints)."
        })
        : null;

    await this.logApiTest({
      engagementId,
      testName: "Rate Limiting Check",
      endpoint: joinUrl(targetUrl, requestPath),
      method: requestMethod,
      parameters: {
        check: "rate_limit",
        requestCount,
        successfulResponses,
        successfulBeforeThrottle,
        first429AtRequest: first429Index === -1 ? null : first429Index + 1
      },
      response: representative,
      finding,
      durationMs: totalDuration
    });

    if (finding) {
      finding.metadata.requestCount = requestCount;
      finding.metadata.totalDurationMs = totalDuration;
      finding.metadata.successfulBeforeThrottle = successfulBeforeThrottle;
      finding.metadata.first429AtRequest = first429Index === -1 ? null : first429Index + 1;
      finding.responseObserved = `No HTTP 429 responses. ${requestCount}/${requestCount} requests succeeded in ${totalDuration}ms.`;
    }

    return finding;
  }

  async runInputValidationTest(targetUrl, endpoint, engagementId) {
    const methodToTest = String(endpoint.method || "").toUpperCase();
    if (!["POST", "PUT"].includes(methodToTest)) {
      return [];
    }

    const requestPath = this.materializePath(endpoint.path);
    const payloads = [
      {
        key: "xss",
        value: "<script>alert('xss')</script>"
      },
      {
        key: "sqli",
        value: "' OR 1=1 --"
      },
      {
        key: "template",
        value: "{{7*7}}"
      }
    ];

    const findings = [];
    for (const payload of payloads) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.safeRequest({
        url: joinUrl(targetUrl, requestPath),
        method: methodToTest,
        headers: {
          "Content-Type": "application/json"
        },
        data: {
          test: payload.value
        }
      });
      const reflected = asString(response.body).includes(payload.value);
      const finding = reflected
        ? this.buildFinding({
            type: "API_INPUT_VALIDATION_MISSING",
            title: `Unescaped input reflection detected on ${requestPath}`,
            description:
              "Potential unsafe input handling: test payload was reflected in response without sanitization.",
            severity: "high",
            endpoint: requestPath,
            methodTested: methodToTest,
            testPerformed: `Sent malicious payload variant (${payload.key}).`,
            responseObserved: `Payload reflected in HTTP ${response.status} response.`,
            remediation:
              "Apply strict schema validation and output encoding; reject unsafe payloads before business logic."
          })
        : null;

      // eslint-disable-next-line no-await-in-loop
      await this.logApiTest({
        engagementId,
        testName: "Input Validation Check",
        endpoint: joinUrl(targetUrl, requestPath),
        method: methodToTest,
        parameters: {
          check: "input_validation",
          payloadType: payload.key
        },
        response,
        finding,
        durationMs: response.durationMs
      });

      if (finding) {
        finding.metadata.reflectedPayload = payload.value;
        finding.responseObserved = `HTTP ${response.status} reflected payload: ${payload.value}`;
        findings.push(finding);
      }
    }

    return findings;
  }

  async checkGraphQLIntrospection(targetUrl, engagementId = null) {
    const response = await this.safeRequest({
      url: joinUrl(targetUrl, "/graphql"),
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      data: {
        query: "{ __schema { types { name } } }"
      }
    });

    const schemaData =
      asObject(response.body).data?.__schema || asObject(response.body).__schema || null;
    const hasIntrospection = Boolean(
      schemaData && Array.isArray(schemaData.types) && schemaData.types.length > 0
    );
    const finding = hasIntrospection
      ? this.buildFinding({
          type: "API_GRAPHQL_INTROSPECTION_ENABLED",
          title: "GraphQL introspection is enabled in production endpoint",
          description:
            "GraphQL schema metadata is publicly retrievable via introspection query.",
          severity: "medium",
          endpoint: "/graphql",
          methodTested: "POST",
          testPerformed: "Submitted GraphQL __schema introspection query.",
          responseObserved: `HTTP ${response.status} with schema type data in response.`,
          remediation:
            "Disable GraphQL introspection in production configuration and restrict schema exploration to trusted environments."
        })
      : null;

    await this.logApiTest({
      engagementId,
      testName: "GraphQL Introspection Check",
      endpoint: joinUrl(targetUrl, "/graphql"),
      method: "POST",
      parameters: {
        check: "graphql_introspection"
      },
      response,
      finding,
      durationMs: response.durationMs
    });

    return finding;
  }

  async scanEngagement(engagementId, targetUrlInput = "") {
    try {
      const engagement = await Engagement.findById(engagementId).lean();
      if (!engagement) {
        const error = new Error("Engagement not found");
        error.code = "ENGAGEMENT_NOT_FOUND";
        throw error;
      }

      const targetUrl = String(targetUrlInput || engagement.targetUrl || "").trim();
      if (!looksLikeHttpUrl(targetUrl)) {
        return {
          findings: [],
          scannedEndpoints: [],
          warning: "Target URL is not a valid HTTP URL."
        };
      }

      logger.info({ engagementId, targetUrl }, "Starting API security scan");
      const discoveredEndpoints = await this.discoverEndpoints(targetUrl);
      const findings = [];

      for (const endpoint of discoveredEndpoints) {
        // eslint-disable-next-line no-await-in-loop
        const missingAuthFinding = await this.runMissingAuthTest(
          targetUrl,
          endpoint,
          String(engagement._id)
        );
        if (missingAuthFinding) {
          findings.push(missingAuthFinding);
        }

        // eslint-disable-next-line no-await-in-loop
        const bolaFinding = await this.runBolaTest(targetUrl, endpoint, String(engagement._id));
        if (bolaFinding) {
          findings.push(bolaFinding);
        }

        // eslint-disable-next-line no-await-in-loop
        const rateLimitFinding = await this.runRateLimitTest(
          targetUrl,
          endpoint,
          String(engagement._id)
        );
        if (rateLimitFinding) {
          findings.push(rateLimitFinding);
        }

        // eslint-disable-next-line no-await-in-loop
        const inputValidationFindings = await this.runInputValidationTest(
          targetUrl,
          endpoint,
          String(engagement._id)
        );
        findings.push(...inputValidationFindings);
      }

      const graphqlFinding = await this.checkGraphQLIntrospection(
        targetUrl,
        String(engagement._id)
      );
      if (graphqlFinding) {
        findings.push(graphqlFinding);
      }

      logger.info(
        {
          engagementId,
          targetUrl,
          endpoints: discoveredEndpoints.length,
          findings: findings.length
        },
        "API security scan complete"
      );

      return {
        findings,
        scannedEndpoints: discoveredEndpoints,
        endpointCount: discoveredEndpoints.length
      };
    } catch (error) {
      logger.error(
        { engagementId, error: error?.message || String(error) },
        "API security scan failed"
      );
      return {
        findings: [],
        scannedEndpoints: [],
        error: error?.message || "API security scan failed"
      };
    }
  }
}

module.exports = new ApiSecurityService();
