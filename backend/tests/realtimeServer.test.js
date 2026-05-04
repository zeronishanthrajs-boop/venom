const test = require("node:test");
const assert = require("node:assert/strict");

const {
  issueRealtimeToken,
  verifyRealtimeToken
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

