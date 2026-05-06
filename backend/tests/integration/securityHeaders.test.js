const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = "test";
const { createApp } = require("../../app");
const app = createApp();

test("health endpoint includes security hardening headers", async () => {
  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers["x-powered-by"], undefined);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.ok(response.headers["content-security-policy"]);
  assert.ok(response.headers["cross-origin-opener-policy"]);
});
