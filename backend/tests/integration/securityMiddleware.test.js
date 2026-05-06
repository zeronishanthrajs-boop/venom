const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.VENOM_API_KEY = process.env.VENOM_API_KEY || "test-key";
process.env.VALID_API_KEYS = process.env.VALID_API_KEYS || "test-key";
process.env.CORS_ORIGINS = "http://localhost:3000";
process.env.API_RATE_LIMIT_MAX = "10000";
process.env.NODE_ENV = "test";

const { createApp } = require("../../app");
const app = createApp();

test("denies disallowed CORS origin with 403", async () => {
  const response = await request(app)
    .options("/api/engagements")
    .set("Origin", "https://evil.example")
    .set("Access-Control-Request-Method", "GET");
  assert.equal(response.status, 403);
  assert.equal(response.body.error, "CORS denied");
});

test("accepts allowed CORS origin", async () => {
  const response = await request(app)
    .options("/api/engagements")
    .set("Origin", "http://localhost:3000")
    .set("Access-Control-Request-Method", "GET");
  assert.equal(response.status, 204);
});

test("rejects non-json content type for write endpoints", async () => {
  const response = await request(app)
    .post("/api/engagements")
    .set("x-api-key", "test-key")
    .set("x-user-id", "tester@example.com")
    .set("x-user-role", "admin")
    .set("Content-Type", "text/plain")
    .send("hello");
  assert.equal(response.status, 415);
});

test("rejects NoSQL operator payload keys", async () => {
  const response = await request(app)
    .post("/api/engagements")
    .set("x-api-key", "test-key")
    .set("x-user-id", "tester@example.com")
    .set("x-user-role", "admin")
    .send({
      name: "x",
      targetUrl: "https://example.com",
      scope: { allowedDomains: ["example.com"], $where: "evil" }
    });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Invalid payload keys/i);
});
