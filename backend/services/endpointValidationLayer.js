const crypto = require("node:crypto");
const { detectWafFromSignals } = require("./responseIntelligenceEngine");

const GENERIC_404_PATTERNS = [
  /not found/i,
  /\b404\b/i,
  /page not found/i,
  /does not exist/i,
  /no page/i,
  /not exist/i
];

const AUTH_PATH_PATTERN = /\/(login|signin|sign-in|auth|session|account|oauth|sso)(?:\/|$|\?)/i;
const PHP_LIKE_EXTENSIONS = /\.(php|asp|aspx|jsp|cfm)(?:$|\?)/i;
const CMS_FAVICON_HASHES = new Map([
  ["d41d8cd98f00b204e9800998ecf8427e", "WordPress"],
  ["2f070cba823016e3f2e4f3f84962f6f1", "Drupal"],
  ["729279300d92c1f5f2d3b6a5f5c7f5bf", "Joomla"]
]);

const STACK_RULES = {
  "Next.js": {
    include: ["/api/", "/api/v1/", "/api/v2/", "/_next/", "/graphql", "/sitemap.xml"],
    excludePattern: PHP_LIKE_EXTENSIONS
  },
  React: {
    include: ["/api/", "/api/v1/", "/api/v2/", "/graphql", "/sitemap.xml"],
    excludePattern: PHP_LIKE_EXTENSIONS
  },
  Vue: {
    include: ["/api/", "/api/v1/", "/api/v2/", "/graphql", "/sitemap.xml"],
    excludePattern: PHP_LIKE_EXTENSIONS
  },
  Nuxt: {
    include: ["/api/", "/api/v1/", "/api/v2/", "/__nuxt/", "/graphql", "/sitemap.xml"],
    excludePattern: PHP_LIKE_EXTENSIONS
  },
  Angular: {
    include: ["/api/", "/api/v1/", "/api/v2/", "/graphql", "/sitemap.xml"],
    excludePattern: PHP_LIKE_EXTENSIONS
  },
  WordPress: {
    include: ["/wp-login.php", "/wp-admin/", "/wp-json/", "/xmlrpc.php", "/wp-config.php"],
    excludePattern: /\/(administrator|user|sites\/default|joomla)(?:\/|$|\?)/i
  },
  Laravel: {
    include: ["/admin", "/login", "/api/", "/.env"],
    excludePattern: /\/(listproducts|artists|categories|showimage)\.php/i
  },
  Symfony: {
    include: ["/admin", "/login", "/api/", "/.env"],
    excludePattern: /\/(listproducts|artists|categories|showimage)\.php/i
  },
  Django: {
    include: ["/admin/", "/api/", "/static/"],
    excludePattern: PHP_LIKE_EXTENSIONS
  },
  Flask: {
    include: ["/admin/", "/api/", "/static/"],
    excludePattern: PHP_LIKE_EXTENSIONS
  }
};

function asString(value) {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    normalized[String(key || "").trim().toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : String(value || "");
  }
  return normalized;
}

function headerValue(headers, name) {
  return normalizeHeaders(headers)[String(name || "").toLowerCase()] || "";
}

function normalizePath(pathValue = "/") {
  const raw = String(pathValue || "").trim();
  if (!raw) return "/";
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname || "/"}${parsed.search || ""}`;
  } catch {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
}

function joinUrl(baseUrl, pathValue) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return `${base}${normalizePath(pathValue)}`;
}

function md5(value) {
  return crypto.createHash("md5").update(value || "").digest("hex");
}

function sameHostname(left, right) {
  try {
    return new URL(left).hostname === new URL(right).hostname;
  } catch {
    return false;
  }
}

function isGeneric404(body) {
  const text = asString(body);
  return GENERIC_404_PATTERNS.some((pattern) => pattern.test(text));
}

function parseLocUrls(xml = "", targetUrl = "") {
  const urls = [];
  const matches = asString(xml).match(/<loc>\s*([^<]+)\s*<\/loc>/gi) || [];
  for (const raw of matches) {
    const match = raw.match(/<loc>\s*([^<]+)\s*<\/loc>/i);
    if (!match) continue;
    try {
      const resolved = new URL(match[1], targetUrl);
      if (sameHostname(resolved.toString(), targetUrl)) {
        urls.push(`${resolved.pathname || "/"}${resolved.search || ""}`);
      }
    } catch {
      // ignore malformed sitemap entries
    }
  }
  return urls;
}

function parseRobotsPaths(robots = "") {
  const paths = [];
  for (const line of asString(robots).split(/\r?\n/)) {
    const match = line.trim().match(/^(allow|disallow)\s*:\s*(\/[^\s#]*)/i);
    if (match) paths.push(match[2]);
  }
  return paths;
}

function extractInternalLinks(html = "", targetUrl = "") {
  const links = [];
  const pattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
  let match = pattern.exec(asString(html));
  while (match) {
    try {
      const resolved = new URL(match[1], targetUrl);
      if (sameHostname(resolved.toString(), targetUrl)) {
        links.push(`${resolved.pathname || "/"}${resolved.search || ""}`);
      }
    } catch {
      // ignore malformed hrefs
    }
    match = pattern.exec(asString(html));
  }
  return links;
}

function extractScriptSources(html = "", targetUrl = "") {
  const sources = [];
  const pattern = /<script[^>]+src=["']([^"']+)["']/gi;
  let match = pattern.exec(asString(html));
  while (match) {
    try {
      const resolved = new URL(match[1], targetUrl);
      if (sameHostname(resolved.toString(), targetUrl)) {
        sources.push(resolved.toString());
      }
    } catch {
      // ignore malformed script srcs
    }
    match = pattern.exec(asString(html));
  }
  return sources;
}

function extractRoutesFromJavaScript(source = "") {
  const routes = new Set();
  const text = asString(source);
  const patterns = [
    /["'`](\/(?:api|v1|v2|graphql|admin|auth|login)[^"'`\s]*)["'`]/gi,
    /\b(?:path|to|href)\s*:\s*["'`](\/[^"'`]+)["'`]/gi,
    /\b(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*["'`](\/[^"'`]+)["'`]/gi
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      routes.add(normalizePath(match[1]));
      match = pattern.exec(text);
    }
  }
  return [...routes];
}

function detectStackFromSignals({ headers = {}, body = "", faviconHash = "" } = {}) {
  const normalizedHeaders = normalizeHeaders(headers);
  const text = asString(body);
  const evidence = [];
  const stacks = new Set();
  const addStack = (stack, reason) => {
    stacks.add(stack);
    evidence.push(reason);
  };

  const poweredBy = normalizedHeaders["x-powered-by"] || "";
  const server = normalizedHeaders.server || "";
  const generator = `${normalizedHeaders["x-generator"] || ""} ${text.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i)?.[1] || ""}`;

  if (/_next\/static|\/_next\//i.test(text)) addStack("Next.js", "Next.js asset path detected.");
  if (/__nuxt|\/__nuxt\//i.test(text)) addStack("Nuxt", "Nuxt asset marker detected.");
  if (/ng-version=|angular/i.test(text) || /angular/i.test(poweredBy)) addStack("Angular", "Angular marker detected.");
  if (/data-reactroot|react/i.test(text) || /react/i.test(poweredBy)) addStack("React", "React marker detected.");
  if (/vue|vite/i.test(poweredBy) || /data-v-|__vue/i.test(text)) addStack("Vue", "Vue marker detected.");
  if (/wp-content\/|wp-includes\/|wordpress/i.test(`${text} ${generator}`) || normalizedHeaders["x-wp-total"]) {
    addStack("WordPress", "WordPress marker detected.");
  }
  if (/drupal\.js|drupal/i.test(`${text} ${generator}`) || normalizedHeaders["x-drupal-cache"]) {
    addStack("Drupal", "Drupal marker detected.");
  }
  if (/joomla/i.test(`${text} ${generator}`)) addStack("Joomla", "Joomla marker detected.");
  if (/laravel/i.test(`${poweredBy} ${server} ${text}`)) addStack("Laravel", "Laravel marker detected.");
  if (/symfony/i.test(`${poweredBy} ${server} ${text}`)) addStack("Symfony", "Symfony marker detected.");
  if (/django/i.test(`${poweredBy} ${server}`)) addStack("Django", "Django marker detected.");
  if (/werkzeug|flask/i.test(`${poweredBy} ${server}`)) addStack("Flask", "Flask marker detected.");

  const faviconStack = CMS_FAVICON_HASHES.get(String(faviconHash || "").toLowerCase());
  if (faviconStack) addStack(faviconStack, `${faviconStack} favicon hash detected.`);

  const detectedStacks = [...stacks];
  return {
    primaryStack: detectedStacks[0] || "Unknown",
    detectedStacks,
    evidence
  };
}

class EndpointValidationLayer {
  constructor({ httpClient = null } = {}) {
    this.httpClient = httpClient;
    this.stackCache = new Map();
  }

  async request({ url, method = "GET", timeout = 2000 }) {
    if (this.httpClient) {
      return this.httpClient({ url, method, timeout });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method,
        redirect: "manual",
        signal: controller.signal
      });
      const body = method === "HEAD" ? "" : await response.text();
      return {
        ok: true,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        headers: {},
        body: "",
        durationMs: Date.now() - startedAt,
        error: error?.message || "request failed",
        timeout: /abort|timeout/i.test(error?.message || "")
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async detectTechnologyStack(targetUrl) {
    const cacheKey = new URL(targetUrl).origin;
    if (this.stackCache.has(cacheKey)) {
      return this.stackCache.get(cacheKey);
    }

    const homepage = await this.request({
      url: joinUrl(targetUrl, "/"),
      method: "GET",
      timeout: 2000
    });
    let faviconHash = "";
    const favicon = await this.request({
      url: joinUrl(targetUrl, "/favicon.ico"),
      method: "GET",
      timeout: 1000
    });
    if (favicon.ok && favicon.body !== undefined && favicon.body !== null) {
      faviconHash = md5(Buffer.isBuffer(favicon.body) ? favicon.body : Buffer.from(asString(favicon.body)));
    }

    const result = detectStackFromSignals({
      headers: homepage.headers,
      body: homepage.body,
      faviconHash
    });
    this.stackCache.set(cacheKey, result);
    return result;
  }

  shouldSkipForStack(endpointPath, stackInfo = {}) {
    const detectedStack = stackInfo.primaryStack || "Unknown";
    const rule = STACK_RULES[detectedStack];
    if (!rule) {
      return {
        skipped: false,
        skipReason: null,
        unverified: detectedStack === "Unknown"
      };
    }
    const path = normalizePath(endpointPath);
    if (rule.excludePattern && rule.excludePattern.test(path)) {
      return {
        skipped: true,
        skipReason: "STACK_MISMATCH",
        unverified: false
      };
    }
    return {
      skipped: false,
      skipReason: null,
      unverified: false
    };
  }

  classifyProbeResponse({ targetUrl, endpointPath, response, followedRedirect = false }) {
    if (!response?.ok) {
      return {
        endpointStatus: "NOT_PRESENT",
        skipReason: response?.timeout ? "PROBE_TIMEOUT" : "CONNECTION_FAILED",
        wafProtected: false,
        authProtected: false,
        unverified: false
      };
    }

    const status = Number(response.status || 0);
    const headers = normalizeHeaders(response.headers);
    const body = asString(response.body);
    const location = headers.location || "";
    const waf = detectWafFromSignals({ headers, body, statusCode: status });

    if ([200, 201, 204].includes(status)) {
      return {
        endpointStatus: "CONFIRMED_PRESENT",
        skipReason: null,
        wafProtected: false,
        authProtected: false,
        unverified: false
      };
    }
    if ([301, 302].includes(status)) {
      const resolved = (() => {
        try {
          return new URL(location, joinUrl(targetUrl, endpointPath)).toString();
        } catch {
          return "";
        }
      })();
      if (AUTH_PATH_PATTERN.test(location)) {
        return {
          endpointStatus: "INFERRED_PRESENT",
          skipReason: null,
          wafProtected: false,
          authProtected: true,
          unverified: false
        };
      }
      if (resolved && sameHostname(resolved, targetUrl)) {
        return {
          endpointStatus: followedRedirect ? "CONFIRMED_PRESENT" : "REDIRECT_FOLLOW_ONCE",
          redirectUrl: resolved,
          skipReason: null,
          wafProtected: false,
          authProtected: false,
          unverified: false
        };
      }
    }
    if (status === 403 && waf.detected) {
      return {
        endpointStatus: "INFERRED_PRESENT",
        skipReason: null,
        wafProtected: true,
        authProtected: false,
        unverified: false
      };
    }
    if (status === 403) {
      return {
        endpointStatus: "ASSUMED_PRESENT",
        skipReason: null,
        wafProtected: false,
        authProtected: false,
        unverified: true
      };
    }
    if (status === 404) {
      if (isGeneric404(body)) {
        return {
          endpointStatus: "NOT_PRESENT",
          skipReason: "GENERIC_404",
          wafProtected: false,
          authProtected: false,
          unverified: false
        };
      }
      return {
        endpointStatus: "INFERRED_PRESENT",
        skipReason: null,
        wafProtected: false,
        authProtected: false,
        unverified: false
      };
    }
    if (status === 410) {
      return {
        endpointStatus: "NOT_PRESENT",
        skipReason: "GONE",
        wafProtected: false,
        authProtected: false,
        unverified: false
      };
    }
    return {
      endpointStatus: "ASSUMED_PRESENT",
      skipReason: null,
      wafProtected: false,
      authProtected: false,
      unverified: true
    };
  }

  async validateEndpoint(targetUrl, endpoint = {}, stackInfo = null) {
    const path = normalizePath(endpoint.path || endpoint.url || "/");
    const detectedStack = stackInfo || (await this.detectTechnologyStack(targetUrl));
    const stackDecision = this.shouldSkipForStack(path, detectedStack);
    const baseResult = {
      url: joinUrl(targetUrl, path),
      path,
      method: String(endpoint.method || "GET").toUpperCase(),
      endpointStatus: "UNKNOWN",
      detectedStack: detectedStack.primaryStack || "Unknown",
      source: endpoint.source || "SUPPLEMENTARY",
      skipReason: null,
      wafProtected: false,
      authProtected: false,
      unverified: Boolean(stackDecision.unverified),
      validationAudit: []
    };

    if (stackDecision.skipped) {
      return {
        ...baseResult,
        endpointStatus: "NOT_PRESENT",
        skipReason: stackDecision.skipReason
      };
    }

    const head = await this.request({
      url: baseResult.url,
      method: "HEAD",
      timeout: 200
    });
    let classification = this.classifyProbeResponse({
      targetUrl,
      endpointPath: path,
      response: head
    });
    baseResult.validationAudit.push({ method: "HEAD", status: head.status || 0 });

    if (!head.ok || head.status === 405 || head.status === 404 || head.status === 403 || classification.endpointStatus === "ASSUMED_PRESENT") {
      const get = await this.request({
        url: baseResult.url,
        method: "GET",
        timeout: 2000
      });
      classification = this.classifyProbeResponse({
        targetUrl,
        endpointPath: path,
        response: get
      });
      baseResult.validationAudit.push({ method: "GET", status: get.status || 0 });
    }

    if (classification.endpointStatus === "REDIRECT_FOLLOW_ONCE" && classification.redirectUrl) {
      const redirected = await this.request({
        url: classification.redirectUrl,
        method: "GET",
        timeout: 2000
      });
      classification = this.classifyProbeResponse({
        targetUrl,
        endpointPath: path,
        response: redirected,
        followedRedirect: true
      });
      baseResult.validationAudit.push({ method: "GET", status: redirected.status || 0, redirected: true });
    }

    return {
      ...baseResult,
      ...classification,
      unverified: Boolean(baseResult.unverified || classification.unverified)
    };
  }

  async discoverDynamicEndpoints(targetUrl, homepageResponse = null) {
    const discovered = [];
    const push = (path, source) => {
      const normalized = normalizePath(path);
      if (normalized) {
        discovered.push({ path: normalized, method: "GET", source: source || "DISCOVERED" });
      }
    };

    const homepage =
      homepageResponse ||
      (await this.request({ url: joinUrl(targetUrl, "/"), method: "GET", timeout: 2000 }));
    if (homepage.ok) {
      for (const link of extractInternalLinks(homepage.body, targetUrl)) push(link, "DISCOVERED");
      for (const route of extractRoutesFromJavaScript(homepage.body)) push(route, "DISCOVERED");
      for (const scriptUrl of extractScriptSources(homepage.body, targetUrl).slice(0, 10)) {
        const script = await this.request({ url: scriptUrl, method: "GET", timeout: 2000 });
        if (script.ok && script.status < 400) {
          for (const route of extractRoutesFromJavaScript(script.body)) push(route, "DISCOVERED");
        }
      }
    }

    const robots = await this.request({
      url: joinUrl(targetUrl, "/robots.txt"),
      method: "GET",
      timeout: 2000
    });
    if (robots.ok && robots.status >= 200 && robots.status < 300) {
      for (const path of parseRobotsPaths(robots.body)) push(path, "DISCOVERED");
    }

    const sitemap = await this.request({
      url: joinUrl(targetUrl, "/sitemap.xml"),
      method: "GET",
      timeout: 2000
    });
    if (sitemap.ok && sitemap.status >= 200 && sitemap.status < 300) {
      for (const path of parseLocUrls(sitemap.body, targetUrl)) push(path, "DISCOVERED");
    }

    return this.deduplicate(discovered);
  }

  buildStackWordlist(stackInfo = {}, genericWordlist = []) {
    const detectedStack = stackInfo.primaryStack || "Unknown";
    const rule = STACK_RULES[detectedStack];
    if (!rule) {
      return genericWordlist.map((path) => ({
        path,
        method: "GET",
        source: "SUPPLEMENTARY",
        unverified: true
      }));
    }
    const filteredGeneric = genericWordlist.filter((path) => {
      if (rule.excludePattern && rule.excludePattern.test(normalizePath(path))) return false;
      return true;
    });
    return [...rule.include, ...filteredGeneric].map((path) => ({
      path,
      method: "GET",
      source: "SUPPLEMENTARY"
    }));
  }

  deduplicate(endpoints = []) {
    const map = new Map();
    for (const endpoint of endpoints) {
      const method = String(endpoint.method || "GET").toUpperCase();
      const path = normalizePath(endpoint.path || endpoint.url || "/");
      const key = `${method}:${path}`;
      if (!map.has(key)) {
        map.set(key, { ...endpoint, method, path });
      }
    }
    return [...map.values()];
  }

  async buildEndpointQueue(targetUrl, { discovered = [], wordlist = [] } = {}) {
    const stackInfo = await this.detectTechnologyStack(targetUrl);
    const dynamic = await this.discoverDynamicEndpoints(targetUrl);
    return {
      stackInfo,
      endpoints: this.deduplicate([
        ...dynamic.map((endpoint) => ({ ...endpoint, source: "DISCOVERED" })),
        ...discovered.map((endpoint) => ({ ...endpoint, source: endpoint.source || "DISCOVERED" })),
        ...this.buildStackWordlist(stackInfo, wordlist)
      ])
    };
  }

  async validateEndpointQueue(targetUrl, endpoints = [], stackInfo = null) {
    const detectedStack = stackInfo || (await this.detectTechnologyStack(targetUrl));
    const accepted = [];
    const skipped = [];
    for (const endpoint of this.deduplicate(endpoints)) {
      const result = await this.validateEndpoint(targetUrl, endpoint, detectedStack);
      if (result.endpointStatus === "NOT_PRESENT") {
        skipped.push(result);
      } else {
        accepted.push(result);
      }
    }
    return {
      detectedStack,
      accepted,
      skipped
    };
  }
}

module.exports = {
  EndpointValidationLayer,
  endpointValidationLayer: new EndpointValidationLayer(),
  detectStackFromSignals,
  extractRoutesFromJavaScript,
  parseLocUrls,
  parseRobotsPaths,
  isGeneric404,
  normalizePath,
  joinUrl
};
