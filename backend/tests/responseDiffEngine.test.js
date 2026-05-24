const test = require("node:test");
const assert = require("node:assert/strict");
const {
  similarityScore,
  evaluateGenericResponsePattern,
  routeLegitimacyBand
} = require("../utils/responseDiffEngine");
const { detectInfrastructureFingerprint } = require("../utils/infrastructureFingerprint");

test("routeLegitimacyBand categorizes scores correctly", () => {
  assert.equal(routeLegitimacyBand(95), "CONFIRMED");
  assert.equal(routeLegitimacyBand(65), "PROBABLE");
  assert.equal(routeLegitimacyBand(35), "UNCERTAIN");
  assert.equal(routeLegitimacyBand(10), "LIKELY_FAKE");
});

test("similarityScore identifies identical responses as highly similar", () => {
  const first = {
    statusCode: 403,
    bodyHash: "abc",
    contentType: "text/html",
    cacheControl: "max-age=0",
    contentEncoding: "gzip",
    redirectLocation: "",
    setCookieCount: 0,
    bodyLength: 128
  };
  const second = {
    statusCode: 403,
    bodyHash: "abc",
    contentType: "text/html",
    cacheControl: "max-age=0",
    contentEncoding: "gzip",
    redirectLocation: "",
    setCookieCount: 0,
    bodyLength: 130
  };
  assert.equal(similarityScore(first, second), 1.0);
});

test("evaluateGenericResponsePattern marks identical baseline responses as likely generic", () => {
  const candidate = {
    statusCode: 403,
    headers: { "content-type": "text/html" },
    body: "generic deny page",
    durationMs: 20
  };
  const baseline = {
    statusCode: 403,
    headers: { "content-type": "text/html" },
    body: "generic deny page",
    durationMs: 20
  };
  const result = evaluateGenericResponsePattern(candidate, [baseline]);
  assert.equal(result.likelyGeneric, true);
  assert.equal(result.confidence, "HIGH");
  assert.ok(result.reason.includes("generic baseline"));
});

test("detectInfrastructureFingerprint finds Cloudflare and Vercel evidence", () => {
  const fingerprint = detectInfrastructureFingerprint({
    headers: {
      server: "cloudflare",
      "cf-ray": "123",
      "x-vercel-id": "abc",
      "x-cache": "HIT"
    },
    body: "<html><body>_next</body></html>",
    targetUrl: "https://example.com"
  });

  assert.ok(fingerprint.cdn.includes("Cloudflare"));
  assert.ok(fingerprint.waf.includes("Cloudflare"));
  assert.ok(fingerprint.hosting.includes("Vercel"));
  assert.equal(fingerprint.confidence, "HIGH");
});
