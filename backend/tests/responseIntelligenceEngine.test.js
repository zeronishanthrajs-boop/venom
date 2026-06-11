const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ResponseIntelligenceEngine,
  classifyResponseMeaning,
  detectWafFromSignals,
  evaluateRateLimitProtocol
} = require("../services/responseIntelligenceEngine");

function missingRateLimitFinding(overrides = {}) {
  return {
    type: "API_MISSING_RATE_LIMIT",
    title: "Insufficient request throttling on /login",
    description: "Endpoint accepted sustained rapid requests without throttling.",
    severity: "high",
    endpoint: "/login",
    evidence: {
      response: {
        statusCode: 200,
        headers: {},
        bodyExcerpt: "ok"
      },
      rateLimitProbe: {
        requestCount: 20,
        statusCodesByRequest: Array.from({ length: 20 }, () => 200),
        latencyRatio: 1.1,
        responseDiff: {
          statusChanged: false,
          bodyChanged: false,
          redirectChanged: false,
          retryAfterIntroduced: false
        },
        networkResets: 0,
        challengeDetected: false,
        explicitBlocking: false,
        silentThrottling: false,
        adaptiveDefense: false
      }
    },
    ...overrides
  };
}

test("classifyResponseMeaning treats HTTP 403 as blocked/protected", () => {
  const result = classifyResponseMeaning({
    statusCode: 403,
    headers: {},
    body: "Forbidden"
  });

  assert.equal(result.meaning, "BLOCKED_OR_PROTECTED");
  assert.equal(result.protected, true);
});

test("detectWafFromSignals fingerprints Cloudflare challenge responses", () => {
  const result = detectWafFromSignals({
    statusCode: 403,
    headers: { server: "cloudflare", "cf-ray": "abc" },
    body: "Checking your browser before accessing example.com"
  });

  assert.equal(result.detected, true);
  assert.ok(result.providers.includes("Cloudflare"));
});

test("rate-limit protocol requires three corroborating no-throttle signals", () => {
  const passing = evaluateRateLimitProtocol(missingRateLimitFinding());
  assert.equal(passing.passes, true);
  assert.equal(passing.signals.length, 3);

  const failing = evaluateRateLimitProtocol(
    missingRateLimitFinding({
      evidence: {
        response: {
          statusCode: 403,
          headers: {},
          bodyExcerpt: "Forbidden"
        },
        rateLimitProbe: {
          requestCount: 20,
          statusCodesByRequest: Array.from({ length: 20 }, () => 403),
          latencyRatio: 1,
          responseDiff: {
            statusChanged: false,
            bodyChanged: false,
            redirectChanged: false,
            retryAfterIntroduced: false
          }
        }
      }
    })
  );

  assert.equal(failing.passes, false);
});

test("ResponseIntelligenceEngine suppresses missing-rate-limit findings on 403 responses", async () => {
  const engine = new ResponseIntelligenceEngine();
  const result = await engine.processFindings([
    missingRateLimitFinding({
      evidence: {
        response: {
          statusCode: 403,
          headers: {},
          bodyExcerpt: "Forbidden"
        },
        rateLimitProbe: {
          requestCount: 20,
          statusCodesByRequest: Array.from({ length: 20 }, () => 403),
          latencyRatio: 1,
          responseDiff: {
            statusChanged: false,
            bodyChanged: false,
            redirectChanged: false,
            retryAfterIntroduced: false
          }
        }
      }
    })
  ]);

  assert.equal(result.findings.length, 0);
  assert.equal(result.suppressedFindings.length, 1);
  assert.match(result.suppressedFindings[0].suppressionReason, /protective\/auth\/WAF/);
  assert.equal(
    result.suppressedFindings[0].metadata.responseIntelligence.responseMeaning,
    "BLOCKED_OR_PROTECTED"
  );
});

test("ResponseIntelligenceEngine preserves well-supported missing-rate-limit findings", async () => {
  const engine = new ResponseIntelligenceEngine();
  const result = await engine.processFindings([missingRateLimitFinding()]);

  assert.equal(result.findings.length, 1);
  assert.equal(result.suppressedFindings.length, 0);
  assert.equal(result.findings[0].confidenceScore, 82);
});
