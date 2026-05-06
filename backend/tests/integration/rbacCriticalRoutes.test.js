const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const mongoose = require("mongoose");

process.env.VENOM_API_KEY = process.env.VENOM_API_KEY || "test-key";
process.env.VALID_API_KEYS = process.env.VALID_API_KEYS || "test-key";
process.env.ENABLE_INMEMORY_DB = "true";
process.env.NODE_ENV = "test";
process.env.API_RATE_LIMIT_MAX = "10000";

const { createApp } = require("../../app");
const { connectDB, stopInMemoryServer } = require("../../config/db");

const app = createApp();

test.before(async () => {
  await connectDB();
});

test.after(async () => {
  await mongoose.disconnect();
  await stopInMemoryServer();
});

test("guest role cannot access admin health", async () => {
  const response = await request(app)
    .get("/api/admin/health")
    .set("x-api-key", "test-key")
    .set("x-user-id", "viewer@example.com")
    .set("x-user-role", "viewer");
  assert.equal(response.status, 403);
});

test("operator role cannot execute global killswitch", async () => {
  const response = await request(app)
    .post("/api/control/killswitch/global")
    .set("x-api-key", "test-key")
    .set("x-user-id", "operator@example.com")
    .set("x-user-role", "operator")
    .send({ active: false, reason: "test" });
  assert.equal(response.status, 403);
});
