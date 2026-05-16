const test = require("node:test");
const assert = require("node:assert/strict");

const {
  issueRealtimeToken,
  verifyRealtimeToken,
  __internal
} = require("../services/realtimeServer");

test("issueRealtimeToken creates verifiable token", () => {
  const token = issueRealtimeToken({
    userId: "operator@example.com",
    role: "owner",
    engagementId: "eng-123"
  });

  const result = verifyRealtimeToken(token);
  assert.equal(result.valid, true);
  assert.equal(result.payload.sub, "operator@example.com");
  assert.equal(result.payload.role, "owner");
  assert.equal(result.payload.engagementId, "eng-123");
});

test("verifyRealtimeToken rejects tampered signature", () => {
  const token = issueRealtimeToken({
    userId: "user",
    role: "operator",
    engagementId: "eng-abc"
  });

  const [payload, signature] = token.split(".");
  const tampered = `${payload}.${signature.slice(0, -2)}ff`;
  const result = verifyRealtimeToken(tampered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "bad_signature");
});

test("verifyRealtimeToken rejects missing token", () => {
  const result = verifyRealtimeToken("");
  assert.equal(result.valid, false);
  assert.equal(result.reason, "missing_or_invalid_token");
});

test("verifyRealtimeToken rejects expired token", () => {
  const payload = {
    sub: "owner@example.com",
    role: "owner",
    engagementId: null,
    iat: Date.now() - 120000,
    exp: Date.now() - 60000
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = __internal.signPayload(payloadBase64);
  const token = `${payloadBase64}.${signature}`;
  const result = verifyRealtimeToken(token);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "expired");
});
