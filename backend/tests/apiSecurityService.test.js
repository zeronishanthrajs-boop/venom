const test = require("node:test");
const assert = require("node:assert/strict");
const apiSecurityService = require("../services/apiSecurityService");
const { buildResponseSnapshot } = require("../utils/responseDiffEngine");

const defaultResponse = ({ status = 200, headers = {}, body = "", durationMs = 20 } = {}) => ({
  ok: true,
  status,
  headers,
  body,
  durationMs
});

test("computeEndpointExistenceConfidence returns LOW confidence for generic 403 responses with edge fingerprints", () => {
  const baselineSnapshot = buildResponseSnapshot({
    status: 403,
    headers: { "content-type": "text/html" },
    body: "generic deny page",
    durationMs: 20
  });

  const result = apiSecurityService.computeEndpointExistenceConfidence({
    requestPath: "/admin",
    response: {
      status: 403,
      headers: { "content-type": "text/html" },
      body: "generic deny page",
      durationMs: 20
    },
    baselineSnapshots: [baselineSnapshot],
    source: "probe",
    infrastructureFingerprint: {
      cdn: ["Cloudflare"],
      waf: ["Cloudflare"],
      defenseSignals: { jsChallenge: true }
    }
  });

  assert.equal(result.confidence, "LOW");
  assert.equal(result.routeLegitimacy, "LIKELY_FAKE");
  assert.equal(result.likelyGeneric, true);
  assert.ok(result.reason.includes("generic"));
});

test("probeEndpointCandidate returns routeLegitimacy when the endpoint appears legitimate", async () => {
  const originalSafeRequest = apiSecurityService.safeRequest;
  apiSecurityService.safeRequest = async () =>
    defaultResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ success: true }),
      durationMs: 35
    });
  apiSecurityService.infrastructureFingerprint = {};
  apiSecurityService.authProfiles = [];

  const discoveryAudit = [];
  const scanLimitations = [];
  const candidate = await apiSecurityService.probeEndpointCandidate({
    targetUrl: "https://example.com",
    path: "/api/test",
    method: "GET",
    source: "probe",
    rootBodyFingerprint: "",
    baselineSnapshots: [],
    discoveryAudit,
    scanLimitations
  });

  apiSecurityService.safeRequest = originalSafeRequest;

  assert.ok(candidate, "Expected a candidate result for a valid endpoint probe");
  assert.equal(candidate.endpointExistenceConfidence, "HIGH");
  assert.equal(candidate.routeLegitimacy, "PROBABLE");
  assert.equal(candidate.method, "GET");
  assert.equal(candidate.path, "/api/test");
});

test("authenticated probe confirmation improves endpoint legitimacy score", async () => {
  const originalSafeRequest = apiSecurityService.safeRequest;
  apiSecurityService.authProfiles = [
    { name: "env-auth", headers: { Authorization: "Bearer test-token" }, source: "env" }
  ];
  apiSecurityService.infrastructureFingerprint = {};

  let requestCount = 0;
  apiSecurityService.safeRequest = async ({ headers = {} } = {}) => {
    requestCount += 1;
    if (headers.Authorization) {
      return defaultResponse({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authenticated: true }),
        durationMs: 25
      });
    }
    return defaultResponse({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ success: true }),
      durationMs: 35
    });
  };

  const discoveryAudit = [];
  const scanLimitations = [];
  const candidate = await apiSecurityService.probeEndpointCandidate({
    targetUrl: "https://example.com",
    path: "/api/test",
    method: "GET",
    source: "probe",
    rootBodyFingerprint: "",
    baselineSnapshots: [],
    discoveryAudit,
    scanLimitations
  });

  apiSecurityService.safeRequest = originalSafeRequest;
  apiSecurityService.authProfiles = [];

  assert.ok(candidate, "Expected a candidate result for a valid authenticated endpoint probe");
  assert.equal(candidate.endpointExistenceConfidence, "HIGH");
  assert.equal(candidate.routeLegitimacy, "CONFIRMED");
  assert.equal(requestCount, 2);
});
