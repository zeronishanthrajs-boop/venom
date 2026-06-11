const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const next = require("next");

const HOST = "127.0.0.1";
const LOGIN_EMAIL = "owner@venom.test";
const LOGIN_PASSWORD = "StrongPass!234";
const TEST_USER_AGENT = "venom-simplified-flow-tests/1.0";
const TEST_IP = "203.0.113.24";

let backendServer;
let dashboardServer;
let dashboardApp;
let dashboardPort = 0;
let backendPort = 0;

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(response) {
    const lines = getSetCookieLines(response.headers);
    for (const line of lines) {
      const chunks = String(line || "")
        .split(";")
        .map((chunk) => chunk.trim())
        .filter(Boolean);
      if (chunks.length === 0) {
        continue;
      }

      const [name, ...valueChunks] = chunks[0].split("=");
      if (!name) {
        continue;
      }
      const value = valueChunks.join("=");
      const maxAgeChunk = chunks.find((chunk) => /^max-age=/i.test(chunk));
      const expiresChunk = chunks.find((chunk) => /^expires=/i.test(chunk));
      const isExpired =
        (maxAgeChunk && Number(maxAgeChunk.split("=")[1]) <= 0) ||
        (expiresChunk &&
          Number.isFinite(Date.parse(expiresChunk.slice("expires=".length))) &&
          Date.parse(expiresChunk.slice("expires=".length)) <= Date.now());

      if (isExpired || value === "") {
        this.cookies.delete(name);
        continue;
      }

      this.cookies.set(name, value);
    }
  }

  header() {
    if (this.cookies.size === 0) {
      return "";
    }
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

function getSetCookieLines(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const raw = headers.get("set-cookie");
  if (!raw) {
    return [];
  }

  return raw.split(/,(?=[^;,]+=)/g);
}

async function closeServer(server) {
  if (!server || !server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve listening address");
  }
  return address.port;
}

async function startBackendStub() {
  backendServer = http.createServer((req, res) => {
    if (req.url === "/api/engagements/eng-test/report?format=json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          engagement: {
            _id: "eng-test",
            targetUrl: "https://example.com",
            status: "running"
          },
          summary: {
            totalExecutionJobs: 4,
            successfulJobs: 2,
            failedJobs: 1,
            blockedJobs: 0,
            timeoutJobs: 1
          },
          executionJobs: [
            {
              findings: [
                {
                  title: "SQL Injection Risk",
                  severity: "high",
                  recommendation: "Use parameterized queries",
                  source: "sqlmap_detect"
                }
              ]
            }
          ]
        })
      );
      return;
    }

    if (req.url === "/api/decisions/eng-test/brief") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          topRisks: [
            {
              title: "SQL Injection Risk",
              immediateAction: "Patch SQL injection in auth endpoint"
            }
          ],
          overallRiskSentence: "Primary risk requires immediate remediation.",
          riskLevel: "high"
        })
      );
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  backendPort = await listen(backendServer);
}

async function startDashboard() {
  process.env.NODE_ENV = "development";
  process.env.VENOM_DASHBOARD_LOGIN_EMAIL = LOGIN_EMAIL;
  process.env.VENOM_DASHBOARD_LOGIN_PASSWORD = LOGIN_PASSWORD;
  process.env.VENOM_DASHBOARD_SESSION_SECRET = "venom-dashboard-test-secret";
  process.env.VENOM_BACKEND_BASE_URL = `http://${HOST}:${backendPort}/`;
  process.env.VENOM_BACKEND_API_KEY = "dashboard-backend-test-key";
  process.env.VENOM_DASHBOARD_BIND_IP = "true";
  process.env.VENOM_DASHBOARD_MONGODB_URI = "";
  process.env.MONGODB_URI = "";
  process.env.GEMINI_API_KEY = "";

  const dashboardDir = path.resolve(__dirname, "..");
  dashboardApp = next({
    dev: true,
    dir: dashboardDir,
    hostname: HOST
  });
  await dashboardApp.prepare();
  const handle = dashboardApp.getRequestHandler();
  dashboardServer = http.createServer((req, res) => handle(req, res));
  dashboardPort = await listen(dashboardServer);
}

async function callDashboard(routePath, options = {}) {
  const {
    method = "GET",
    jar,
    body,
    userAgent = TEST_USER_AGENT,
    ip = TEST_IP,
    headers = {},
    redirect = "manual"
  } = options;

  const outboundHeaders = {
    "user-agent": userAgent,
    "x-forwarded-for": ip,
    ...headers
  };

  if (jar) {
    const cookieHeader = jar.header();
    if (cookieHeader) {
      outboundHeaders.cookie = cookieHeader;
    }
  }

  if (body !== undefined && outboundHeaders["content-type"] === undefined) {
    outboundHeaders["content-type"] = "application/json";
  }

  const response = await fetch(`http://${HOST}:${dashboardPort}${routePath}`, {
    method,
    headers: outboundHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect
  });

  if (jar) {
    jar.absorb(response);
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return {
    response,
    payload
  };
}

async function login(jar) {
  return callDashboard("/api/auth/login", {
    method: "POST",
    jar,
    body: {
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD
    }
  });
}

test.before(async () => {
  await startBackendStub();
  await startDashboard();
});

test.after(async () => {
  await closeServer(dashboardServer);
  if (dashboardApp && typeof dashboardApp.close === "function") {
    await dashboardApp.close();
  }
  await closeServer(backendServer);
});

test("dashboard route redirects to simplified new-scan page", async () => {
  const jar = new CookieJar();
  await login(jar);

  const { response } = await callDashboard("/dashboard", {
    jar,
    redirect: "manual"
  });

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/dashboard/new-scan");
});

test("report chat endpoint requires auth", async () => {
  const { response, payload } = await callDashboard("/api/assistant/report-chat", {
    method: "POST",
    body: {
      engagementId: "eng-test",
      question: "status"
    }
  });

  assert.equal(response.status, 401);
  assert.equal(payload.error, "Unauthorized");
});

test("report chat endpoint answers from report context", async () => {
  const jar = new CookieJar();
  await login(jar);

  const { response, payload } = await callDashboard("/api/assistant/report-chat", {
    method: "POST",
    jar,
    body: {
      engagementId: "eng-test",
      question: "What is the status?",
      reportSnapshot: {
        status: "running",
        findingsCount: 1,
        topFindings: [
          {
            severity: "high",
            title: "SQL Injection Risk",
            recommendation: "Use parameterized queries"
          }
        ]
      }
    }
  });

  assert.equal(response.status, 200);
  assert.equal(payload.source, "heuristic");
  assert.match(payload.answer, /Current status:/i);
});
