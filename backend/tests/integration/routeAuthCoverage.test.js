const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.VENOM_API_KEY = process.env.VENOM_API_KEY || "test-key";
process.env.VALID_API_KEYS = process.env.VALID_API_KEYS || "test-key";
process.env.API_RATE_LIMIT_MAX = "10000";
process.env.NODE_ENV = "test";

const { createApp } = require("../../app");
const app = createApp();

const validId = "507f1f77bcf86cd799439011";

const endpoints = [
  ["post", "/api/evolve/prompts"],
  ["get", "/api/evolve/prompts/history"],
  ["post", "/api/learn"],
  ["get", `/api/control/scope/${validId}`],
  ["get", `/api/control/preview/${validId}`],
  ["get", "/api/control/killswitch"],
  ["post", "/api/control/killswitch/global"],
  ["post", `/api/control/killswitch/engagement/${validId}`],
  ["get", "/api/control/activity/recent"],
  ["get", `/api/evidence/${validId}`],
  ["get", `/api/evidence/${validId}/verify`],
  ["post", `/api/chain/${validId}`],
  ["get", `/api/compliance/${validId}`],
  ["post", "/api/research/trigger"],
  ["get", "/api/research/latest"],
  ["get", "/api/research/log"],
  ["post", "/api/engagements"],
  ["get", "/api/engagements"],
  ["get", `/api/engagements/${validId}`],
  ["get", `/api/engagements/${validId}/report`],
  ["delete", `/api/engagements/${validId}`],
  ["post", "/api/admin/fix-draft-statuses"],
  ["post", "/api/admin/fix-tool-whitelists"],
  ["post", "/api/admin/fix-orphaned-jobs"],
  ["post", "/api/admin/fix-stale-running-engagements"],
  ["post", "/api/admin/fix-all"],
  ["get", "/api/admin/health"],
  ["post", "/api/cves/sync"],
  ["get", "/api/cves"],
  ["get", "/api/cves/stats"],
  ["get", "/api/cves/summary"],
  ["get", `/api/reports/${validId}/pdf`],
  ["get", `/api/reports/${validId}/html`],
  ["get", `/api/reports/${validId}/markdown`],
  ["get", `/api/reports/${validId}/md`],
  ["post", `/api/reports/${validId}/email`],
  ["post", `/api/decisions/${validId}/brief`],
  ["get", `/api/decisions/${validId}/brief`],
  ["get", "/api/metrics/overview"],
  ["get", "/api/metrics/alerts"],
  ["get", `/api/metrics/progress/${validId}`],
  ["get", "/api/metrics/progress"],
  ["get", `/api/monitoring/${validId}/snapshots`],
  ["post", `/api/monitoring/${validId}/snapshot`],
  ["get", `/api/monitoring/${validId}/changes`],
  ["get", "/api/realtime/token"],
  ["get", "/api/realtime/status"],
  ["get", "/api/prompts/active"],
  ["get", "/api/prompts/history"],
  ["post", "/api/prompts/evolve"],
  ["post", "/api/prompts/evolve/run"],
  ["get", "/api/orchestrate/status"],
  ["post", "/api/orchestrate"],
  ["post", `/api/orchestrate/${validId}`],
  ["post", "/api/plan"],
  ["get", `/api/plan/${validId}/explain`],
  ["get", `/api/plan/engagement/${validId}`],
  ["get", "/api/execute/tools"],
  ["post", "/api/execute"],
  ["get", `/api/execute/engagement/${validId}`],
  ["get", `/api/execute/${validId}`],
  ["post", "/api/patterns"],
  ["get", "/api/patterns/match"],
  ["get", "/api/patterns"],
  ["post", `/api/secrets/scan/${validId}`],
  ["get", `/api/secrets/${validId}`],
  ["post", `/api/supplychain/scan/${validId}`],
  ["get", `/api/supplychain/${validId}`],
  ["post", `/api/cloudconfig/scan/${validId}`],
  ["get", `/api/cloudconfig/${validId}`],
  ["post", `/api/apis/scan/${validId}`],
  ["get", `/api/apis/${validId}`],
  ["post", `/api/container/scan/${validId}`],
  ["get", `/api/container/${validId}`],
  ["get", `/api/reports/${validId}/hardened`],
  ["get", `/api/reports/${validId}/detailed-with-execution`]
];

for (const [method, path] of endpoints) {
  test(`auth required: ${method.toUpperCase()} ${path}`, async () => {
    const response = await request(app)[method](path);
    assert.equal(response.status, 401);
  });
}
