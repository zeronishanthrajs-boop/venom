const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const next = require("next");

const HOST = "127.0.0.1";
const LOGIN_EMAIL = "owner@venom.test";
const LOGIN_PASSWORD = "StrongPass!234";
const TEST_USER_AGENT = "venom-integration-suite/1.0";
const TEST_IP = "198.51.100.24";

let backendServer;
let dashboardServer;
let dashboardApp;
let dashboardPort = 0;
let backendPort = 0;
const backendRequests = [];

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

  get(name) {
    return this.cookies.get(name) || null;
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
    backendRequests.push({
      method: req.method || "GET",
      url: req.url || "/",
      headers: req.headers
    });

    if (req.url === "/api/realtime/token") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          token: "stub-realtime-token",
          engagementId: null,
          wsPath: "/ws",
          expiresInMs: 60000
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
  process.env.VENOM_BACKEND_BASE_URL = `http://${HOST}:${backendPort}`;
  process.env.VENOM_BACKEND_API_KEY = "dashboard-backend-test-key";
  process.env.VENOM_DASHBOARD_BIND_IP = "true";
  process.env.VENOM_DASHBOARD_MONGODB_URI = "";
  process.env.MONGODB_URI = "";

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
    headers = {}
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
    redirect: "manual"
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

async function login(jar, { userAgent = TEST_USER_AGENT, ip = TEST_IP } = {}) {
  return callDashboard("/api/auth/login", {
    method: "POST",
    jar,
    userAgent,
    ip,
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

test.beforeEach(() => {
  backendRequests.length = 0;
});

test("login sets access and refresh cookies", async () => {
  const jar = new CookieJar();
  const { response, payload } = await login(jar);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.session.email, LOGIN_EMAIL);
  assert.ok(jar.get("venom_auth"));
  assert.ok(jar.get("venom_refresh"));
});

test("session endpoint returns active session after login", async () => {
  const jar = new CookieJar();
  await login(jar);

  const { response, payload } = await callDashboard("/api/auth/session", { jar });
  assert.equal(response.status, 200);
  assert.ok(payload.session);
  assert.equal(payload.session.email, LOGIN_EMAIL);
});

test("refresh rotates refresh token", async () => {
  const jar = new CookieJar();
  await login(jar);

  const before = jar.get("venom_refresh");
  assert.ok(before);

  const { response, payload } = await callDashboard("/api/auth/refresh", {
    method: "POST",
    jar
  });
  const after = jar.get("venom_refresh");

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.ok(after);
  assert.notEqual(before, after);
});

test("ip binding allows subnet rotation within /16 and blocks outside /16", async () => {
  const jar = new CookieJar();
  await login(jar, {
    ip: "198.51.100.10",
    userAgent: TEST_USER_AGENT
  });

  const sameBucket = await callDashboard("/api/auth/session", {
    jar,
    ip: "198.51.100.245",
    userAgent: TEST_USER_AGENT
  });
  assert.equal(sameBucket.response.status, 200);
  assert.ok(sameBucket.payload.session);

  const differentBucket = await callDashboard("/api/auth/session", {
    jar,
    ip: "198.52.101.9",
    userAgent: TEST_USER_AGENT
  });
  assert.equal(differentBucket.response.status, 200);
  assert.equal(differentBucket.payload.session, null);
});

test("logout revokes tokens and blocks reuse of stolen cookies", async () => {
  const jar = new CookieJar();
  await login(jar);
  const stolenCookieHeader = jar.header();

  const logoutResult = await callDashboard("/api/auth/logout", {
    method: "POST",
    jar
  });
  assert.equal(logoutResult.response.status, 200);
  assert.equal(logoutResult.payload.ok, true);

  const refreshReuse = await callDashboard("/api/auth/refresh", {
    method: "POST",
    headers: {
      cookie: stolenCookieHeader
    }
  });
  assert.equal(refreshReuse.response.status, 401);

  const sessionReuse = await callDashboard("/api/auth/session", {
    headers: {
      cookie: stolenCookieHeader
    }
  });
  assert.equal(sessionReuse.response.status, 200);
  assert.equal(sessionReuse.payload.session, null);
});

test("backend bridge blocks unauthenticated calls and forwards auth headers", async () => {
  const denied = await callDashboard("/api/backend/api/realtime/token");
  assert.equal(denied.response.status, 401);

  const jar = new CookieJar();
  await login(jar);

  const allowed = await callDashboard("/api/backend/api/realtime/token", { jar });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.payload.token, "stub-realtime-token");

  assert.equal(backendRequests.length, 1);
  const forwarded = backendRequests[0];
  assert.equal(forwarded.method, "GET");
  assert.equal(forwarded.url, "/api/realtime/token");
  assert.equal(forwarded.headers["x-api-key"], "dashboard-backend-test-key");
  assert.equal(forwarded.headers["x-user-id"], LOGIN_EMAIL);
  assert.equal(forwarded.headers["x-user-role"], "owner");
});
