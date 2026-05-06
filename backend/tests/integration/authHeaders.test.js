const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.VENOM_API_KEY = process.env.VENOM_API_KEY || "test-key";
process.env.VALID_API_KEYS = process.env.VALID_API_KEYS || "test-key";
process.env.API_RATE_LIMIT_MAX = "10000";
process.env.NODE_ENV = "test";

const { createApp } = require("../../app");
const app = createApp();

test("rejects missing auth headers", async () => {
  const response = await request(app).get("/api/engagements");
  assert.equal(response.status, 401);
  assert.match(response.body.error, /Missing auth headers|Unauthorized/i);
});

test("rejects invalid userId format", async () => {
  const response = await request(app)
    .get("/api/engagements")
    .set("x-api-key", "test-key")
    .set("x-user-id", "bad id with space")
    .set("x-user-role", "admin");
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Invalid userId format/i);
});

test("rejects invalid role", async () => {
  const response = await request(app)
    .get("/api/engagements")
    .set("x-api-key", "test-key")
    .set("x-user-id", "tester@example.com")
    .set("x-user-role", "superuser");
  assert.equal(response.status, 400);
  assert.match(response.body.error, /Invalid role/i);
});

test("rejects invalid API key", async () => {
  const response = await request(app)
    .get("/api/engagements")
    .set("x-api-key", "wrong-key")
    .set("x-user-id", "tester@example.com")
    .set("x-user-role", "admin");
  assert.equal(response.status, 401);
  assert.match(response.body.error, /Unauthorized/i);
});
