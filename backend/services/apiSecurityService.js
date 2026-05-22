const axios = require("axios");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const Engagement = require("../models/Engagement");
const executionLoggerService = require("./executionLoggerService");
const { logger } = require("../config/logger");
const { classifyEndpoint } = require("../utils/endpointClassification");
const {
  deriveConfidenceLevel,
  needsManualValidation,
  normalizeConfidenceLevel
} = require("../utils/confidenceModel");
const {
  createStructuredError,
  logError,
  logWarn
} = require("../utils/scanErrors");
const execFileAsync = promisify(execFile);

const API_SPEC_PATHS = ["/openapi.json", "/swagger.json", "/api-docs", "/v3/api-docs"];
const COMMON_API_PATHS = [
  "/api",
  "/api/v1",
  "/api/users",
  "/api/admin",
  "/api/products",
  "/api/login"
];
const COMMON_WEB_PATHS = [
  "/",
  "/index.php",
  "/search",
  "/search.php?test=query",
  "/login",
  "/login.php",
  "/admin",
  "/products",
  "/product",
  "/list",
  "/list.php",
  "/listproducts.php?cat=1",
  "/product.php?id=1",
  "/view",
  "/view.php?id=1",
  "/user",
  "/user.php?id=1",
  "/profile",
  "/profile.php?id=1",
  "/upload",
  "/upload.php",
  "/download",
  "/download.php?file=test.txt",
  "/artists.php?artist=1",
  "/categories.php",
  "/showimage.php?file=./pictures/1.jpg"
];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const PII_HINTS = ["email", "phone", "password", "token", "ssn", "address", "dob"];
const DISCOVERY_VALID_STATUS_CODES = new Set([
  200,
  201,
  204,
  301,
  302,
  307,
  308,
  401,
  403,
  405
]);
const DISCOVERY_NON_EXISTENT_STATUS_CODES = new Set([404, 410]);
const DISCOVERY_TOOL_HEALTH_STATUS_CODES = new Set([500, 502, 503]);
const STATIC_ASSET_EXTENSIONS = new Set([
  ".js",
  ".css",
  ".map",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz"
]);
const STATIC_PATH_PATTERNS = [
  "/assets/",
  "/static/",
  "/public/",
  "/images/",
  "/fonts/",
  "/icons/",
  "/_next/",
  "/dist/",
  "/build/"
];
const EVIDENCE_EXCLUDED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-internal-token",
  "x-venom-internal-token"
]);
const SQL_ERROR_PATTERNS = [
  /you have an error in your sql syntax/i,
  /warning:\s*mysql/i,
  /unclosed quotation mark/i,
  /quoted string not properly terminated/i,
  /odbc|jdbc|sqlite|postgresql|mariadb/i
];
const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];

function normalizeSeverityValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SEVERITY_ORDER.includes(normalized) ? normalized : "low";
}

function contextualizeSeverity(baseSeverity, endpointContext = {}) {
  const current = normalizeSeverityValue(baseSeverity);
  const currentIndex = SEVERITY_ORDER.indexOf(current);
  if (currentIndex === -1) {
    return current;
  }
  const sensitivity = String(endpointContext?.sensitivity || "MEDIUM").toUpperCase();
  let minimumIndex = 0;
  if (sensitivity === "CRITICAL" || sensitivity === "HIGH") {
    minimumIndex = SEVERITY_ORDER.indexOf("medium");
  }
  const finalIndex = Math.max(currentIndex, minimumIndex);
  return SEVERITY_ORDER[Math.min(finalIndex, SEVERITY_ORDER.length - 1)];
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asString(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function looksLikeHttpUrl(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizePath(pathValue) {
  const raw = String(pathValue || "").trim();
  if (!raw) {
    return "/";
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const parsed = new URL(raw);
      return parsed.pathname || "/";
    } catch {
      return "/";
    }
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function joinUrl(baseUrl, endpointPath) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const path = normalizePath(endpointPath);
  return `${base}${path}`;
}

function buildTestId(prefix) {
  return `test-api-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function trimBodyExcerpt(body, maxLength = 200) {
  const text = asString(body).replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.slice(0, maxLength);
}

function sanitizeHeadersForEvidence(headers = {}) {
  const sanitized = {};
  for (const [rawKey, rawValue] of Object.entries(asObject(headers))) {
    const key = String(rawKey || "").trim().toLowerCase();
    if (!key || EVIDENCE_EXCLUDED_REQUEST_HEADERS.has(key)) {
      continue;
    }
    sanitized[key] = asString(rawValue).slice(0, 400);
  }
  return sanitized;
}

function isStaticAssetPath(pathValue = "") {
  const normalized = normalizePath(pathValue).toLowerCase();
  if (STATIC_PATH_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return true;
  }
  const stripped = normalized.split("#")[0] || normalized;
  const lastDot = stripped.lastIndexOf(".");
  if (lastDot === -1) {
    return false;
  }
  const extension = stripped.slice(lastDot).match(/^(\.[a-z0-9]+)(?:$|[?&=])/i);
  return extension ? STATIC_ASSET_EXTENSIONS.has(extension[1].toLowerCase()) : false;
}

function buildCurlRequest(method, url, headers = {}, body = null) {
  const commandParts = ["curl", "-i", "-X", String(method || "GET").toUpperCase(), `'${url}'`];
  for (const [rawHeader, rawValue] of Object.entries(headers)) {
    const key = String(rawHeader || "").trim();
    if (!key) {
      continue;
    }
    commandParts.push("-H");
    commandParts.push(`'${key}: ${String(rawValue || "").replace(/'/g, "'\\''")}'`);
  }
  if (body !== null && body !== undefined && body !== "") {
    commandParts.push("--data-raw");
    commandParts.push(`'${String(body).replace(/'/g, "'\\''")}'`);
  }
  return commandParts.join(" ");
}

function normalizeBodyForFingerprint(body) {
  return asString(body).replace(/\s+/g, " ").trim();
}

class ApiSecurityService {
  constructor(httpClient = axios, executionLogger = executionLoggerService) {
    this.httpClient = httpClient;
    this.executionLogger = executionLogger;
  }

  parseOpenApiSpec(spec = {}) {
    const parsed = asObject(spec);
    const paths = asObject(parsed.paths);
    const endpoints = [];

    for (const [rawPath, definition] of Object.entries(paths)) {
      const pathItem = asObject(definition);
      for (const method of HTTP_METHODS) {
        const key = method.toLowerCase();
        if (pathItem[key]) {
          endpoints.push({
            path: normalizePath(rawPath),
            method,
            source: "openapi"
          });
        }
      }
    }

    return endpoints;
  }

  deduplicateEndpoints(endpoints = []) {
    const seen = new Set();
    const deduped = [];
    for (const endpoint of endpoints) {
      const path = normalizePath(endpoint.path);
      const method = String(endpoint.method || "GET").toUpperCase();
      const key = `${method}:${path}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push({
        path,
        method,
        source: endpoint.source || "probe"
      });
    }
    return deduped;
  }

  toDiscoveryAuditMessage(responseStatus, path) {
    if (DISCOVERY_NON_EXISTENT_STATUS_CODES.has(responseStatus)) {
      return `Target responded ${responseStatus} â€” path does not exist â€” skipped`;
    }
    if (DISCOVERY_TOOL_HEALTH_STATUS_CODES.has(responseStatus)) {
      return `Target responded ${responseStatus} during discovery probe â€” server error observed â€” logged as scan limitation`;
    }
    return `Target responded ${responseStatus} for discovery probe ${path}`;
  }

  buildConnectionFailureMessage(errorMessage = "") {
    return `Connection failed before response â€” tool or network issue â€” logged as scan limitation (${errorMessage || "request failed"})`;
  }

  isDiscoveryStatusEligible(statusCode) {
    return DISCOVERY_VALID_STATUS_CODES.has(Number(statusCode || 0));
  }

  async probeEndpointCandidate({
    targetUrl,
    path,
    method = "GET",
    source = "probe",
    rootBodyFingerprint = "",
    discoveryAudit = [],
    scanLimitations = []
  }) {
    const normalizedPath = normalizePath(path);
    if (isStaticAssetPath(normalizedPath)) {
      return null;
    }

    const probeMethod = String(method || "GET").toUpperCase();
    const response = await this.safeRequest({
      url: joinUrl(targetUrl, normalizedPath),
      method: probeMethod,
      timeout: 8000
    });

    if (!response.ok) {
      scanLimitations.push({
        category: "API Security",
        phase: "endpoint_discovery",
        endpoint: normalizedPath,
        method: probeMethod,
        status: "FAILED",
        errorCode: response.errorCode || (response.timeout ? "NETWORK_TIMEOUT" : "NETWORK_ERROR"),
        reason: this.buildConnectionFailureMessage(response.error)
      });
      discoveryAudit.push({
        path: normalizedPath,
        method: probeMethod,
        source,
        statusCode: 0,
        action: "limited",
        message: this.buildConnectionFailureMessage(response.error)
      });
      return null;
    }

    const statusCode = Number(response.status || 0);
    if (this.isDiscoveryStatusEligible(statusCode)) {
      const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
      const currentBodyFingerprint =
        statusCode === 200 ? normalizeBodyForFingerprint(response.body) : "";
      if (
        statusCode === 200 &&
        normalizedPath !== "/" &&
        source !== "openapi" &&
        rootBodyFingerprint &&
        currentBodyFingerprint &&
        contentType.includes("text/html") &&
        currentBodyFingerprint === rootBodyFingerprint
      ) {
        discoveryAudit.push({
          path: normalizedPath,
          method: probeMethod,
          source,
          statusCode,
          action: "skipped",
          message:
            "Target returned the same HTML shell as root for this path â€” probable SPA fallback/soft-404 â€” skipped from API test queue"
        });
        return null;
      }
      discoveryAudit.push({
        path: normalizedPath,
        method: probeMethod,
        source,
        statusCode,
        action: "queued",
        message: `Path responded ${statusCode} â€” endpoint considered valid and queued for API tests`
      });
      return {
        path: normalizedPath,
        method: probeMethod,
        source
      };
    }

    if (DISCOVERY_NON_EXISTENT_STATUS_CODES.has(statusCode)) {
      discoveryAudit.push({
        path: normalizedPath,
        method: probeMethod,
        source,
        statusCode,
        action: "skipped",
        message: this.toDiscoveryAuditMessage(statusCode, normalizedPath)
      });
      return null;
    }

    if (DISCOVERY_TOOL_HEALTH_STATUS_CODES.has(statusCode)) {
      const message = this.toDiscoveryAuditMessage(statusCode, normalizedPath);
      scanLimitations.push({
        category: "API Security",
        phase: "endpoint_discovery",
        endpoint: normalizedPath,
        method: probeMethod,
        status: "FAILED",
        errorCode: `HTTP_${statusCode}`,
        reason: message
      });
      discoveryAudit.push({
        path: normalizedPath,
        method: probeMethod,
        source,
        statusCode,
        action: "limited",
        message
      });
      return null;
    }

    discoveryAudit.push({
      path: normalizedPath,
      method: probeMethod,
      source,
      statusCode,
      action: "skipped",
      message: `Target responded ${statusCode} â€” not in endpoint validity allowlist â€” skipped`
    });
    return null;
  }

  async safeRequest({
    url,
    method = "GET",
    headers = {},
    data = undefined,
    timeout = 6000
  }) {
    const startedAt = Date.now();
    try {
      const response = await this.httpClient.request({
        url,
        method,
        headers,
        data,
        timeout,
        maxRedirects: 2,
        validateStatus: () => true
      });
      return {
        ok: true,
        status: Number(response.status || 0),
        headers: asObject(response.headers),
        body: response.data,
        durationMs: Date.now() - startedAt
      };
    } catch (error) {
      logWarn(
        logger,
        { url, method, timeout },
        "API scanner HTTP request failed",
        error
      );
      const errorCode = String(error?.code || "").toUpperCase();
      return {
        ok: false,
        status: 0,
        headers: {},
        body: null,
        durationMs: Date.now() - startedAt,
        error: error?.message || "request failed",
        errorCode,
        timeout: errorCode === "ECONNABORTED" || /timeout/i.test(error?.message || "")
      };
    }
  }

  async runWafDetection(targetUrl) {
    try {
      const { stdout = "", stderr = "" } = await execFileAsync(
        "wafw00f",
        [targetUrl, "-a"],
        {
          timeout: 20000,
          maxBuffer: 1024 * 1024
        }
      );
      const combined = `${stdout}\n${stderr}`;
      const match = combined.match(/is behind (.+?) WAF/i) || combined.match(/behind (.+?)$/im);
      const provider = match ? String(match[1] || "").trim() : "";
      return {
        status: "SUCCESS",
        detected: Boolean(provider) || /is behind/i.test(combined),
        provider: provider || "Unknown WAF",
        output: combined.slice(0, 4000)
      };
    } catch (error) {
      const code = String(error?.code || "").toUpperCase();
      if (code === "ENOENT") {
        return {
          status: "TOOL_NOT_INSTALLED",
          detected: false,
          provider: "",
          reason: "wafw00f is not installed."
        };
      }
      const combined = `${String(error?.stdout || "")}\n${String(error?.stderr || "")}`;
      const match = combined.match(/is behind (.+?) WAF/i) || combined.match(/behind (.+?)$/im);
      if (match) {
        return {
          status: "SUCCESS",
          detected: true,
          provider: String(match[1] || "").trim() || "Unknown WAF",
          output: combined.slice(0, 4000)
        };
      }
      return {
        status: "FAILED",
        detected: false,
        provider: "",
        reason: error?.message || "wafw00f execution failed."
      };
    }
  }

  async runReconnaissance(targetUrl) {
    const limitations = [];
    const endpoints = [];
    let baseHost = "";
    try {
      baseHost = new URL(targetUrl).hostname;
    } catch {
      return { endpoints, limitations, discoveredHosts: [] };
    }
    const discoveredHosts = new Set([baseHost]);

    try {
      const { stdout = "" } = await execFileAsync(
        "subfinder",
        ["-silent", "-d", baseHost],
        {
          timeout: 25000,
          maxBuffer: 1024 * 1024 * 2
        }
      );
      for (const line of String(stdout).split(/\r?\n/)) {
        const host = String(line || "").trim().toLowerCase();
        if (!host) {
          continue;
        }
        discoveredHosts.add(host);
      }
    } catch (error) {
      const code = String(error?.code || "").toUpperCase();
      limitations.push({
        phase: "recon",
        tool: "subfinder",
        status: code === "ENOENT" ? "TOOL_NOT_INSTALLED" : "FAILED",
        reason: code === "ENOENT" ? "subfinder is not installed." : error?.message || "subfinder failed."
      });
    }

    const hostsToCrawl = [...discoveredHosts].slice(0, 20);
    for (const host of hostsToCrawl) {
      const candidateUrls = [`https://${host}`, `http://${host}`];
      for (const candidateUrl of candidateUrls) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const { stdout = "" } = await execFileAsync(
            "katana",
            ["-silent", "-u", candidateUrl, "-d", "2", "-timeout", "10", "-jc"],
            {
              timeout: 30000,
              maxBuffer: 1024 * 1024 * 2
            }
          );
          const lines = String(stdout).split(/\r?\n/);
          for (const line of lines) {
            const urlText = String(line || "").trim();
            if (!urlText) {
              continue;
            }
            try {
              const parsed = new URL(urlText, candidateUrl);
              if (!discoveredHosts.has(parsed.hostname.toLowerCase())) {
                continue;
              }
              endpoints.push({
                path: `${parsed.pathname || "/"}${parsed.search || ""}`,
                method: "GET",
                source: "katana"
              });
            } catch {
              // ignore malformed crawl line
            }
          }
          break;
        } catch (error) {
          const code = String(error?.code || "").toUpperCase();
          limitations.push({
            phase: "recon",
            tool: "katana",
            status: code === "ENOENT" ? "TOOL_NOT_INSTALLED" : "FAILED",
            reason: code === "ENOENT" ? "katana is not installed." : error?.message || "katana failed."
          });
          if (code === "ENOENT") {
            break;
          }
        }
      }
    }

    return {
      endpoints: this.deduplicateEndpoints(endpoints),
      limitations,
      discoveredHosts: [...discoveredHosts]
    };
  }

  async discoverEndpoints(targetUrl) {
    const discoveryAudit = [];
    const scanLimitations = [];
    const candidates = [];
    if (!looksLikeHttpUrl(targetUrl)) {
      return {
        endpoints: [],
        discoveryAudit,
        scanLimitations
      };
    }

    const reconResult = await this.runReconnaissance(targetUrl);
    for (const limitation of Array.isArray(reconResult.limitations) ? reconResult.limitations : []) {
      scanLimitations.push({
        category: "API Security",
        phase: "reconnaissance",
        endpoint: targetUrl,
        method: "GET",
        status: String(limitation.status || "FAILED").toUpperCase(),
        errorCode: String(limitation.status || "FAILED").toUpperCase(),
        reason:
          limitation.reason ||
          `${String(limitation.tool || "recon")} did not complete successfully.`
      });
    }
    if (Array.isArray(reconResult.endpoints) && reconResult.endpoints.length > 0) {
      candidates.push(...reconResult.endpoints);
    }

    let openApiCandidates = [];
    for (const specPath of API_SPEC_PATHS) {
      const specResponse = await this.safeRequest({
        url: joinUrl(targetUrl, specPath),
        method: "GET"
      });
      if (specResponse.status < 200 || specResponse.status >= 300) {
        continue;
      }
      const parsed =
        typeof specResponse.body === "string"
          ? (() => {
              try {
                return JSON.parse(specResponse.body);
              } catch (error) {
                logWarn(
                  logger,
                  { targetUrl, specPath },
                  "OpenAPI spec response was not valid JSON",
                  error
                );
                return {};
              }
            })()
          : asObject(specResponse.body);
      const specEndpoints = this.parseOpenApiSpec(parsed);
      if (specEndpoints.length > 0) {
        openApiCandidates = specEndpoints;
        break;
      }
    }

    if (openApiCandidates.length > 0) {
      candidates.push(...openApiCandidates);
    } else {
      let rootBodyFingerprint = "";
      candidates.push({ path: "/", method: "GET", source: "root" });
      const rootResponse = await this.safeRequest({
        url: joinUrl(targetUrl, "/"),
        method: "GET",
        timeout: 8000
      });
      if (
        rootResponse.ok &&
        this.isDiscoveryStatusEligible(rootResponse.status) &&
        !isStaticAssetPath("/")
      ) {
        rootBodyFingerprint = normalizeBodyForFingerprint(rootResponse.body);
        candidates.push(...this.extractEndpointsFromHtml(rootResponse.body, targetUrl));
      }

      let hasCustom404 = false;
      const canaryResA = await this.safeRequest({
        url: joinUrl(targetUrl, "/venom-canary-test-a7f3b2/"),
        method: "GET",
        timeout: 5000
      });
      const canaryResB = await this.safeRequest({
        url: joinUrl(targetUrl, "/venom-canary-test-b9e4c1/"),
        method: "GET",
        timeout: 5000
      });
      if (canaryResA.status === 200 && canaryResB.status === 200) {
        hasCustom404 = true;
        logger.info(
          { targetUrl },
          "Custom 404 detected — fallback path list suppressed. Only discovered endpoints will be tested."
        );
      }

      if (!hasCustom404) {
        for (const path of [...COMMON_API_PATHS, ...COMMON_WEB_PATHS]) {
          candidates.push({ path, method: "GET", source: "fallback" });
        }
      }

      const validated = [];
      const dedupedCandidates = this.deduplicateEndpoints(candidates);
      for (const candidate of dedupedCandidates) {
        // eslint-disable-next-line no-await-in-loop
        const accepted = await this.probeEndpointCandidate({
          targetUrl,
          path: candidate.path,
          method: candidate.method,
          source: candidate.source || "probe",
          rootBodyFingerprint,
          discoveryAudit,
          scanLimitations
        });
        if (accepted) {
          validated.push(accepted);
        }
      }

      return {
        endpoints: this.deduplicateEndpoints(validated),
        discoveryAudit,
        scanLimitations
      };
    }

    const validated = [];
    const dedupedCandidates = this.deduplicateEndpoints(candidates);
    for (const candidate of dedupedCandidates) {
      // eslint-disable-next-line no-await-in-loop
      const accepted = await this.probeEndpointCandidate({
        targetUrl,
        path: candidate.path,
        method: candidate.method,
        source: candidate.source || "probe",
        rootBodyFingerprint: "",
        discoveryAudit,
        scanLimitations
      });
      if (accepted) {
        validated.push(accepted);
      }
    }

    return {
      endpoints: this.deduplicateEndpoints(validated),
      discoveryAudit,
      scanLimitations
    };
  }

  extractEndpointsFromHtml(body, targetUrl) {
    const html = asString(body);
    if (!html.trim()) {
      return [];
    }
    const discovered = [];
    const hrefPattern = /\bhref\s*=\s*["']([^"']+)["']/gi;
    let match = hrefPattern.exec(html);
    while (match) {
      const href = String(match[1] || "").trim();
      try {
        const resolved = new URL(href, targetUrl);
        const base = new URL(targetUrl);
        if (resolved.hostname === base.hostname) {
          discovered.push({
            path: `${resolved.pathname || "/"}${resolved.search || ""}`,
            method: "GET",
            source: "html-link"
          });
        }
      } catch (error) {
        logWarn(logger, { href, targetUrl }, "API scanner could not parse discovered link", error);
      }
      match = hrefPattern.exec(html);
    }
    return discovered;
  }

  materializePath(path) {
    const normalized = normalizePath(path);
    return normalized.replace(/\{[^/}]+\}/g, "1");
  }

  incrementEndpointId(path) {
    const materialized = this.materializePath(path);
    const queryIndex = materialized.indexOf("?");
    if (queryIndex !== -1) {
      const pathname = materialized.slice(0, queryIndex) || "/";
      const params = new URLSearchParams(materialized.slice(queryIndex + 1));
      for (const [key, value] of params.entries()) {
        if (/^\d+$/.test(String(value))) {
          params.set(key, String(Number.parseInt(value, 10) + 1));
          return `${pathname}?${params.toString()}`;
        }
      }
    }
    const segments = materialized.split("/");
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (!/^\d+$/.test(segments[index])) {
        continue;
      }
      segments[index] = String(Number.parseInt(segments[index], 10) + 1);
      return segments.join("/");
    }
    return null;
  }

  hasQueryParams(path) {
    return normalizePath(path).includes("?");
  }

  buildPathWithQueryPayload(path, paramName, payload) {
    const materialized = this.materializePath(path);
    const [pathname, rawQuery = ""] = materialized.split("?");
    const params = new URLSearchParams(rawQuery);
    params.set(paramName, payload);
    return `${pathname || "/"}?${params.toString()}`;
  }

  getQueryParamNames(path) {
    const query = String(path || "").split("?")[1] || "";
    return [...new URLSearchParams(query).keys()];
  }

  hasSqlError(body) {
    const text = asString(body);
    return SQL_ERROR_PATTERNS.some((pattern) => pattern.test(text));
  }

  containsSensitiveData(body) {
    const serialized = asString(body).toLowerCase();
    return PII_HINTS.some((field) => serialized.includes(field));
  }

  buildFinding({
    idPrefix = "api",
    type,
    title,
    description,
    severity,
    endpoint,
    methodTested,
    testPerformed,
    responseObserved,
    remediation,
    evidence = null,
    discoveryVector = "",
    reproductionSteps = [],
    detectionConfidence = "strong signal",
    exploitConfidence = "weak signal",
    severityReason = ""
  }) {
    const endpointContext = classifyEndpoint(endpoint);
    const normalizedBaseSeverity = normalizeSeverityValue(severity);
    const contextualSeverity = contextualizeSeverity(normalizedBaseSeverity, endpointContext);
    const normalizedDetectionConfidence = String(detectionConfidence || "strong signal")
      .trim()
      .toLowerCase();
    const normalizedExploitConfidence = String(exploitConfidence || "weak signal")
      .trim()
      .toLowerCase();
    const confidenceVal =
      normalizeConfidenceLevel(
        normalizeConfidenceLevel(normalizedDetectionConfidence) ||
          normalizeConfidenceLevel(normalizedExploitConfidence)
      ) ||
      deriveConfidenceLevel({
        severity: contextualSeverity,
        detectionConfidence: normalizedDetectionConfidence,
        exploitConfidence: normalizedExploitConfidence
      });

    let confidence = confidenceVal;
    let finalDetectionConfidence = normalizedDetectionConfidence;
    let finalExploitConfidence = normalizedExploitConfidence;

    const isInjectionOrReflection =
      /injection|reflected|xss|ssti|reflection|sql/i.test(String(type || "").trim()) ||
      /injection|reflected|xss|ssti|reflection|sql/i.test(String(title || "").trim()) ||
      /injection|reflected|xss|ssti|reflection|sql/i.test(String(description || "").trim()) ||
      /injection|reflected|xss|ssti|reflection|sql/i.test(String(testPerformed || "").trim());

    if (this.wafDetected && isInjectionOrReflection) {
      confidence = "WEAK_SIGNAL";
      finalDetectionConfidence = "weak signal";
      finalExploitConfidence = "weak signal";
    }

    const manualValidationRequired = needsManualValidation(confidence);
    const effectiveSeverityReason =
      String(severityReason || "").trim() ||
      `Severity adjusted from '${normalizedBaseSeverity.toUpperCase()}' to '${contextualSeverity.toUpperCase()}' based on ${endpointContext.endpointType.toLowerCase()} endpoint context (${endpointContext.sensitivity}).`;
    const normalizedReproductionSteps = Array.isArray(reproductionSteps)
      ? reproductionSteps.filter((step) => String(step || "").trim().length > 0)
      : [];
    const safeEvidence =
      evidence && typeof evidence === "object" && !Array.isArray(evidence)
        ? evidence
        : {
            status: "failed",
            reason:
              typeof evidence === "string" && evidence
                ? evidence
                : "Evidence capture failed — no request/response snapshot was recorded by the scanner."
          };
    return {
      id: `${idPrefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      type,
      severity: contextualSeverity,
      category: "API Security",
      title,
      description,
      recommendation: remediation,
      remediation,
      source: "api_security",
      endpoint,
      methodTested,
      testPerformed,
      responseObserved,
      endpointType: endpointContext.endpointType,
      endpointSensitivity: endpointContext.sensitivity,
      severityReason: effectiveSeverityReason,
      confidence,
      manualValidationRequired,
      manualValidationNote: manualValidationRequired
        ? "Manual validation recommended before treating as confirmed vulnerability."
        : "",
      evidence: safeEvidence,
      discoveryVector:
        String(discoveryVector || "").trim() ||
        "Evidence capture failed — discovery vector was not supplied by this scanner step.",
      reproductionSteps:
        normalizedReproductionSteps.length > 0
          ? normalizedReproductionSteps
          : ["Evidence capture failed — reproduction steps were not generated for this finding."],
      detectionConfidence: finalDetectionConfidence,
      exploitConfidence: finalExploitConfidence,
      tags: ["api-security", String(type || "").toLowerCase()],
      metadata: {
        findingType: type,
        endpoint,
        methodTested,
        testPerformed,
        responseObserved,
        endpointContext,
        severityReason: effectiveSeverityReason,
        confidence,
        manualValidationRequired,
        manualValidationNote: manualValidationRequired
          ? "Manual validation recommended before treating as confirmed vulnerability."
          : "",
        discoveryVector:
          String(discoveryVector || "").trim() ||
          "Evidence capture failed — discovery vector was not supplied by this scanner step.",
        reproductionSteps:
          normalizedReproductionSteps.length > 0
            ? normalizedReproductionSteps
            : ["Evidence capture failed — reproduction steps were not generated for this finding."],
        evidence: safeEvidence
      }
    };
  }

  async logApiTest({
    engagementId,
    testName,
    endpoint,
    method,
    parameters,
    response,
    finding = null,
    durationMs = 0
  }) {
    if (!engagementId) {
      return;
    }
    const statusCode = Number(response?.status || 0);
    const failedResponse = response && response.ok === false;
    const resultStatus = failedResponse ? "FAILED" : finding ? "VULNERABLE" : "PASSED";
    const failureReason = failedResponse
      ? `NETWORK_ERROR: ${response.error || "Request failed before scanner could evaluate the endpoint."}`
      : "";
    await this.executionLogger.logTestExecution({
      engagementId,
      testId: buildTestId(String(testName || "check").toLowerCase().replace(/\s+/g, "-")),
      testName,
      tool: "VENOM API Scanner",
      category: "API Security",
      target: endpoint,
      parameters: {
        endpoint,
        method,
        ...(parameters || {})
      },
      response: {
        statusCode,
        headers: response?.headers || {},
        bodySize: asString(response?.body).length
      },
      result: {
        status: resultStatus,
        confidence: finding ? 0.9 : 0.85,
        reason: finding
          ? String(finding.title || "Potential API vulnerability detected.")
          : failedResponse
            ? failureReason
          : "No vulnerability signal detected.",
        failureReason,
        errorCode: failedResponse ? "NETWORK_ERROR" : "",
        severity: finding?.severity || "low"
      },
      executionTimeMs: durationMs,
      findingCount: finding ? 1 : 0
    });
  }

  buildEvidenceSnapshot({
    url,
    method,
    requestHeaders = {},
    requestBody = null,
    response,
    includeBodyExcerpt = true,
    notes = []
  }) {
    const responseHeaders = sanitizeHeadersForEvidence(response?.headers || {});
    return {
      request: {
        url,
        method: String(method || "GET").toUpperCase(),
        headers: sanitizeHeadersForEvidence(requestHeaders),
        body: requestBody,
        timestamp: new Date().toISOString()
      },
      response: {
        statusCode: Number(response?.status || 0),
        headers: responseHeaders,
        responseTimeMs: Number(response?.durationMs || 0),
        bodyExcerpt: includeBodyExcerpt ? trimBodyExcerpt(response?.body, 200) : ""
      },
      notes: Array.isArray(notes) ? notes.filter((item) => String(item || "").trim().length > 0) : []
    };
  }

  async runMissingAuthTest(targetUrl, endpoint, engagementId) {
    const requestPath = this.materializePath(endpoint.path);
    const requestMethod = endpoint.method === "HEAD" ? "GET" : endpoint.method;
    const requestUrl = joinUrl(targetUrl, requestPath);
    const response = await this.safeRequest({
      url: requestUrl,
      method: requestMethod,
      headers: {}
    });
    const isApiPath = requestPath.toLowerCase().includes("/api");
    const vulnerable = response.status === 200 && isApiPath;
    const authEvidence = this.buildEvidenceSnapshot({
      url: requestUrl,
      method: requestMethod,
      requestHeaders: {},
      response,
      includeBodyExcerpt: true,
      notes: [
        "Authentication probe executed without Authorization header and without session cookie.",
        vulnerable
          ? "Response returned HTTP 200 for API-style path without auth."
          : `Response returned HTTP ${Number(response.status || 0)} when unauthenticated request was sent.`
      ]
    });
    const endpointContext = classifyEndpoint(requestPath);
    const finding = vulnerable
      ? this.buildFinding({
          type: "API_MISSING_AUTHENTICATION",
          title: `Unauthenticated endpoint exposed: ${requestPath}`,
          description:
            "Endpoint accepted request without Authorization header or API key.",
          severity: endpointContext.endpointType === "ADMIN" ? "critical" : "high",
          endpoint: requestPath,
          methodTested: endpoint.method,
          testPerformed: "Sent request without Authorization or API key headers.",
          responseObserved: `HTTP ${response.status}`,
          evidence: authEvidence,
          discoveryVector:
            "Auth probe: request sent without Authorization header or session cookie; response status and body were inspected for protected data exposure.",
          reproductionSteps: [
            buildCurlRequest(requestMethod, requestUrl, {
              Authorization: "",
              Cookie: ""
            }),
            `Expected secure behavior: HTTP 401/403. Observed during scan: HTTP ${Number(response.status || 0)}.`
          ],
          remediation:
            "Add authentication middleware (e.g., auth guard) before this route and enforce token/API-key validation."
        })
      : null;

    await this.logApiTest({
      engagementId,
      testName: "Missing Authentication Check",
      endpoint: joinUrl(targetUrl, requestPath),
      method: endpoint.method,
      parameters: {
        check: "missing_authentication",
        headersSent: "none",
        credentialsSent: "none"
      },
      response,
      finding,
      durationMs: response.durationMs
    });

    return finding;
  }

  async runBolaTest(targetUrl, endpoint, engagementId) {
    const originalPath = this.materializePath(endpoint.path);
    const incrementedPath = this.incrementEndpointId(endpoint.path);
    if (!incrementedPath) {
      return null;
    }
    const requestMethod = endpoint.method === "HEAD" ? "GET" : endpoint.method;
    const requestUrl = joinUrl(targetUrl, incrementedPath);

    const response = await this.safeRequest({
      url: requestUrl,
      method: requestMethod,
      headers: {}
    });
    const vulnerable = response.status === 200 && this.containsSensitiveData(response.body);
    const bolaEvidence = this.buildEvidenceSnapshot({
      url: requestUrl,
      method: requestMethod,
      requestHeaders: {},
      response,
      includeBodyExcerpt: true,
      notes: [
        `Original object path: ${originalPath}`,
        `Mutated object path: ${incrementedPath}`,
        vulnerable
          ? "Response body contained sensitive field hints after object ID mutation."
          : "No sensitive field hints were detected after object ID mutation."
      ]
    });
    const finding = vulnerable
      ? this.buildFinding({
          type: "API_BROKEN_OBJECT_LEVEL_AUTHORIZATION",
          title: `Potential BOLA on ${originalPath}`,
          description:
            "Incremented resource identifier returned accessible sensitive data, indicating missing ownership validation.",
          severity: "critical",
          endpoint: incrementedPath,
          methodTested: endpoint.method,
          testPerformed: `Changed object identifier from ${originalPath} to ${incrementedPath} and replayed request.`,
          responseObserved: `HTTP ${response.status} with sensitive fields in response body.`,
          evidence: bolaEvidence,
          discoveryVector:
            "BOLA probe: numeric identifier was incremented and replayed without credentials; response body was checked for sensitive data patterns.",
          reproductionSteps: [
            buildCurlRequest(requestMethod, requestUrl, {
              Authorization: "",
              Cookie: ""
            }),
            "Compare response data against the authenticated user's own object; access to another user's data indicates broken object-level authorization."
          ],
          remediation:
            "Validate object ownership before returning data by comparing the authenticated user ID to the resource owner ID."
        })
      : null;

    await this.logApiTest({
      engagementId,
      testName: "BOLA Check",
      endpoint: joinUrl(targetUrl, incrementedPath),
      method: endpoint.method,
      parameters: {
        check: "bola",
        originalPath,
        incrementedPath
      },
      response,
      finding,
      durationMs: response.durationMs
    });

    return finding;
  }

  async runRateLimitTest(targetUrl, endpoint, engagementId, options = {}) {
    const requestPath = this.materializePath(endpoint.path);
    const requestMethod = endpoint.method === "HEAD" ? "GET" : endpoint.method;
    const requestCount = 20;
    const responses = [];
    const startedAt = Date.now();
    for (let index = 0; index < requestCount; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.safeRequest({
        url: joinUrl(targetUrl, requestPath),
        method: requestMethod
      });
      responses.push(response);
    }
    const totalDuration = Date.now() - startedAt;
    const first429Index = responses.findIndex((item) => item.status === 429);
    const statusTimeline = responses.map((item) => Number(item.status || 0));
    const statusCounts = statusTimeline.reduce((acc, statusCode) => {
      const key = String(statusCode);
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});
    const successfulResponses = responses.filter(
      (item) => item.status >= 200 && item.status < 300
    ).length;
    const successfulBeforeThrottle =
      first429Index === -1
        ? successfulResponses
        : responses
            .slice(0, first429Index)
            .filter((item) => item.status >= 200 && item.status < 300).length;
    const representative = responses[0] || {
      status: 0,
      body: null,
      headers: {},
      durationMs: totalDuration
    };
    const requestUrl = joinUrl(targetUrl, requestPath);
    const endpointContext = classifyEndpoint(requestPath);
    const severityByEndpointType = {
      AUTH: "high",
      ADMIN: "high",
      FUNCTIONAL: "medium",
      INFORMATIONAL: "low"
    };
    const contextualRateLimitSeverity =
      severityByEndpointType[endpointContext.endpointType] || "medium";
    let defenseReason = null;
    if (first429Index !== -1) {
      defenseReason = `Rate limiting was actively enforced on ${requestPath} after ${first429Index} requests.`;
      if (Array.isArray(options.defenseSignals)) {
        options.defenseSignals.push({
          type: "RATE_LIMIT_ENFORCED",
          reason: defenseReason
        });
      }
    } else if (successfulResponses < requestCount && representative.status >= 400) {
      defenseReason = `WAF or network control blocked probe on ${requestPath} after ${successfulResponses} requests.`;
      if (Array.isArray(options.defenseSignals)) {
        options.defenseSignals.push({
          type: "WAF_BLOCK",
          reason: defenseReason
        });
      }
    }

    const finding =
      first429Index === -1
        ? this.buildFinding({
          type: "API_MISSING_RATE_LIMIT",
          title: `No standard rate limiting detected on ${requestPath}`,
          description: `${requestCount} sequential rapid requests did not trigger a standard HTTP 429 Too Many Requests response.`,
          severity: contextualRateLimitSeverity,
          endpoint: requestPath,
          methodTested: requestMethod,
          testPerformed: `Executed ${requestCount} sequential rapid unauthenticated requests.`,
          responseObserved: `First 429 index: -1. Successful requests: ${successfulResponses}/${requestCount}.`,
          evidence: {
            request: {
              url: requestUrl,
              method: requestMethod,
              headers: {},
              timestamp: new Date().toISOString()
            },
            response: {
              statusCode: Number(representative.status || 0),
              headers: sanitizeHeadersForEvidence(representative.headers || {}),
              responseTimeMs: Number(representative.durationMs || 0),
              bodyExcerpt: trimBodyExcerpt(representative.body, 200)
            },
            rateLimitProbe: {
              requestCount,
              statusCodesByRequest: statusTimeline,
              statusCodeHistogram: statusCounts,
              received429: first429Index !== -1,
              first429AtRequest: first429Index === -1 ? null : first429Index + 1,
              totalDurationMs: totalDuration,
              testedThreshold: requestCount
            },
            notes: [
              "Rate limit probe found no standard 429 HTTP response code.",
              defenseReason ? defenseReason : "All requests succeeded without throttling."
            ]
          },
          discoveryVector:
            "Rate limit probe: bulk rapid requests sent to test threshold enforcement.",
          reproductionSteps: [
            `for i in {1..${requestCount}}; do curl -s -o /dev/null -w "%{http_code}\\n" -X ${requestMethod} '${requestUrl}'; done`,
            "Check for HTTP 429 or appropriate throttle response."
          ],
          remediation:
            "Apply request throttling (for example: 60 requests/minute for public endpoints and 20 requests/minute for authenticated/session endpoints).",
          severityReason: `Rate-limiting severity mapped by endpoint class '${endpointContext.endpointType}' (${endpointContext.sensitivity}).`
        })
        : null;

    await this.logApiTest({
      engagementId,
      testName: "Rate Limiting Check",
      endpoint: joinUrl(targetUrl, requestPath),
      method: requestMethod,
      parameters: {
        check: "rate_limit",
        requestCount,
        successfulResponses,
        successfulBeforeThrottle,
        first429AtRequest: first429Index === -1 ? null : first429Index + 1,
        statusCodeHistogram: statusCounts
      },
      response: representative,
      finding,
      durationMs: totalDuration
    });

    if (first429Index !== -1 && Array.isArray(options?.defenseSignals)) {
      options.defenseSignals.push({
        type: "RATE_LIMIT_ENFORCED",
        endpoint: requestPath,
        method: requestMethod,
        first429AtRequest: first429Index + 1,
        requestCount,
        durationMs: totalDuration
      });
    }

    if (finding) {
      finding.metadata.requestCount = requestCount;
      finding.metadata.totalDurationMs = totalDuration;
      finding.metadata.successfulBeforeThrottle = successfulBeforeThrottle;
      finding.metadata.first429AtRequest = first429Index === -1 ? null : first429Index + 1;
      finding.metadata.statusCodeHistogram = statusCounts;
      finding.metadata.statusCodesByRequest = statusTimeline;
      finding.responseObserved = `No HTTP 429 responses. ${requestCount}/${requestCount} requests succeeded in ${totalDuration}ms.`;
    }

    return finding;
  }

  async runInputValidationTest(targetUrl, endpoint, engagementId, options = {}) {
    const methodToTest = String(endpoint.method || "").toUpperCase();
    if (this.hasQueryParams(endpoint.path)) {
      return this.runQueryParameterInjectionTest(targetUrl, endpoint, engagementId, options);
    }
    if (!["POST", "PUT"].includes(methodToTest)) {
      return [];
    }

    const requestPath = this.materializePath(endpoint.path);
    const payloads = [
      {
        key: "xss",
        value: "<script>alert('xss')</script>"
      },
      {
        key: "sqli",
        value: "' OR 1=1 --"
      },
      {
        key: "template",
        value: "{{7*7}}"
      }
    ];

    const findings = [];
    for (const payload of payloads) {
      // eslint-disable-next-line no-await-in-loop
      const response = await this.safeRequest({
        url: joinUrl(targetUrl, requestPath),
        method: methodToTest,
        headers: {
          "Content-Type": "application/json"
        },
        data: {
          test: payload.value
        }
      });
      const reflected = asString(response.body).includes(payload.value);
      const requestUrl = joinUrl(targetUrl, requestPath);
      const requestHeaders = {
        "Content-Type": "application/json"
      };
      const finding = reflected
        ? this.buildFinding({
            type: "POTENTIAL_REFLECTED_INPUT",
            title: `Potential Reflected Input - Manual Validation Required (${requestPath})`,
            description:
              "Input reflected in response body. Browser-based validation required to confirm exploitability.",
            severity: "info",
            endpoint: requestPath,
            methodTested: methodToTest,
            testPerformed: `Sent malicious payload variant (${payload.key}).`,
            responseObserved: `Payload reflected in HTTP ${response.status} response.`,
            evidence: this.buildEvidenceSnapshot({
              url: requestUrl,
              method: methodToTest,
              requestHeaders,
              requestBody: JSON.stringify({ test: payload.value }),
              response,
              includeBodyExcerpt: true,
              notes: [
                `Payload type tested: ${payload.key}`,
                "Input reflected in response body.",
                "Browser-based validation required to confirm exploitability."
              ]
            }),
            discoveryVector:
              "Input validation probe: malicious payload variants were submitted in JSON body and response reflections were inspected.",
            reproductionSteps: [
              buildCurlRequest(
                methodToTest,
                requestUrl,
                requestHeaders,
                JSON.stringify({ test: payload.value })
              ),
              "Input reflected in response body.",
              "Browser-based validation required to confirm exploitability."
            ],
            remediation:
              "Apply strict schema validation and output encoding; reject unsafe payloads before business logic.",
            detectionConfidence: "weak signal",
            exploitConfidence: "weak signal",
            severityReason:
              "Reflection signal without confirmed execution path is treated as informational pending manual validation."
          })
        : null;

      // eslint-disable-next-line no-await-in-loop
      await this.logApiTest({
        engagementId,
        testName: "Input Validation Check",
        endpoint: joinUrl(targetUrl, requestPath),
        method: methodToTest,
        parameters: {
          check: "input_validation",
          payloadType: payload.key
        },
        response,
        finding,
        durationMs: response.durationMs
      });

      if (finding) {
        finding.metadata.reflectedPayload = payload.value;
        finding.responseObserved = `HTTP ${response.status} reflected payload: ${payload.value}`;
        findings.push(finding);
      }
    }

    return findings;
  }

  async runQueryParameterInjectionTest(targetUrl, endpoint, engagementId, options = {}) {
    const requestPath = this.materializePath(endpoint.path);
    const paramNames = this.getQueryParamNames(requestPath);
    if (paramNames.length === 0) {
      return [];
    }

    const payloads = [
      { key: "sqli_quote", value: "1'" },
      { key: "sqli_boolean", value: "1 OR 1=1" },
      { key: "xss_reflection", value: "<script>alert('venom')</script>" }
    ];
    const findings = [];

    for (const paramName of paramNames) {
      for (const payload of payloads) {
        const testPath = this.buildPathWithQueryPayload(requestPath, paramName, payload.value);
        // eslint-disable-next-line no-await-in-loop
        const response = await this.safeRequest({
          url: joinUrl(targetUrl, testPath),
          method: "GET",
          timeout: 8000
        });

        const body = asString(response.body);
        const reflected = body.includes(payload.value);
        const sqlError = this.hasSqlError(body);
        const finding =
          sqlError || reflected
            ? this.buildFinding({
                type: sqlError ? "SQL_INJECTION" : "POTENTIAL_REFLECTED_INPUT",
                title: sqlError
                  ? `SQL error response triggered by query parameter '${paramName}'`
                  : `Potential Reflected Input - Manual Validation Required ('${paramName}')`,
                description: sqlError
                  ? "A quote/boolean SQL payload caused a database error signature in the HTTP response."
                  : "Input reflected in response body. Browser-based validation required to confirm exploitability.",
                severity: sqlError ? "high" : "info",
                endpoint: testPath,
                methodTested: "GET",
                testPerformed: `Changed query parameter ${paramName} using ${payload.key} payload.`,
                responseObserved: sqlError
                  ? `HTTP ${response.status} with SQL error signature.`
                  : `HTTP ${response.status} reflected the supplied payload.`,
                evidence: this.buildEvidenceSnapshot({
                  url: joinUrl(targetUrl, testPath),
                  method: "GET",
                  requestHeaders: {},
                  response,
                  includeBodyExcerpt: true,
                  notes: [
                    `Parameter tested: ${paramName}`,
                    `Payload type: ${payload.key}`,
                    sqlError
                      ? "SQL error signature detected in response body."
                      : "Input reflected in response body. Browser-based validation required to confirm exploitability."
                  ]
                }),
                discoveryVector:
                  "Query parameter injection probe: query-string parameters were mutated with SQLi/XSS payloads and response bodies were inspected for reflection or SQL error signatures.",
                reproductionSteps: [
                  buildCurlRequest("GET", joinUrl(targetUrl, testPath)),
                  sqlError
                    ? "If SQL error signatures are visible in the response, query parameter handling is vulnerable to SQL injection patterns."
                    : "Input reflected in response body. Browser-based validation required to confirm exploitability."
                ],
                remediation: sqlError
                  ? "Use parameterized queries for all query-string inputs and suppress database errors in responses."
                  : "Apply output encoding and strict input validation for reflected query parameters.",
                detectionConfidence:
                  sqlError && !options?.wafDetected ? "strong signal" : "weak signal",
                exploitConfidence:
                  sqlError && !options?.wafDetected ? "strong signal" : "weak signal",
                severityReason: sqlError
                  ? options?.wafDetected
                    ? "SQL signal observed while WAF is present; confidence reduced pending manual validation."
                    : "SQL error signature is a strong signal for injection risk."
                  : "Reflection signal without browser execution confirmation is informational pending manual validation."
              })
            : null;

        // eslint-disable-next-line no-await-in-loop
        await this.logApiTest({
          engagementId,
          testName: "Query Parameter Injection Check",
          endpoint: joinUrl(targetUrl, testPath),
          method: "GET",
          parameters: {
            check: "query_parameter_injection",
            paramName,
            payloadType: payload.key
          },
          response,
          finding,
          durationMs: response.durationMs
        });

        if (finding) {
          finding.metadata.paramName = paramName;
          finding.metadata.payloadType = payload.key;
          findings.push(finding);
        }
      }
    }

    return findings;
  }

  async checkGraphQLIntrospection(targetUrl, engagementId = null) {
    const requestBody = {
      query: "{ __schema { types { name } } }"
    };
    const response = await this.safeRequest({
      url: joinUrl(targetUrl, "/graphql"),
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      data: requestBody
    });

    const schemaData =
      asObject(response.body).data?.__schema || asObject(response.body).__schema || null;
    const hasIntrospection = Boolean(
      schemaData && Array.isArray(schemaData.types) && schemaData.types.length > 0
    );
    const finding = hasIntrospection
      ? this.buildFinding({
          type: "API_GRAPHQL_INTROSPECTION_ENABLED",
          title: "GraphQL introspection is enabled in production endpoint",
          description:
            "GraphQL schema metadata is publicly retrievable via introspection query.",
          severity: "medium",
          endpoint: "/graphql",
          methodTested: "POST",
          testPerformed: "Submitted GraphQL __schema introspection query.",
          responseObserved: `HTTP ${response.status} with schema type data in response.`,
          evidence: this.buildEvidenceSnapshot({
            url: joinUrl(targetUrl, "/graphql"),
            method: "POST",
            requestHeaders: {
              "Content-Type": "application/json"
            },
            requestBody: JSON.stringify(requestBody),
            response,
            includeBodyExcerpt: true,
            notes: [
              "GraphQL introspection query executed against /graphql endpoint.",
              hasIntrospection
                ? "Schema data was returned, confirming introspection exposure."
                : "No schema data was returned."
            ]
          }),
          discoveryVector:
            "GraphQL probe: POST request with __schema introspection query was sent and response body was inspected for schema metadata.",
          reproductionSteps: [
            buildCurlRequest(
              "POST",
              joinUrl(targetUrl, "/graphql"),
              { "Content-Type": "application/json" },
              JSON.stringify(requestBody)
            ),
            "If the response includes __schema/type metadata, GraphQL introspection is enabled."
          ],
          remediation:
            "Disable GraphQL introspection in production configuration and restrict schema exploration to trusted environments."
        })
      : null;

    await this.logApiTest({
      engagementId,
      testName: "GraphQL Introspection Check",
      endpoint: joinUrl(targetUrl, "/graphql"),
      method: "POST",
      parameters: {
        check: "graphql_introspection"
      },
      response,
      finding,
      durationMs: response.durationMs
    });

    return finding;
  }

  async scanEngagement(engagementId, targetUrlInput = "") {
    try {
      const engagement = await Engagement.findById(engagementId).lean();
      if (!engagement) {
        const error = new Error("Engagement not found");
        error.code = "ENGAGEMENT_NOT_FOUND";
        throw error;
      }

      const targetUrl = String(targetUrlInput || engagement.targetUrl || "").trim();
      if (!looksLikeHttpUrl(targetUrl)) {
        const structuredError = createStructuredError(
          new Error("Target URL is not a valid HTTP URL."),
          {
            errorCode: "INVALID_TARGET_URL",
            message: "Target URL is not a valid HTTP URL."
          }
        );
        return {
          ...structuredError,
          findings: [],
          scannedEndpoints: [],
          warning: structuredError.message
        };
      }

      this.wafDetected = false;
      logger.info({ engagementId, targetUrl }, "Starting API security scan");
      const scanStartedAt = Date.now();
      const discoveryResult = await this.discoverEndpoints(targetUrl);
      const discoveredEndpoints = this.deduplicateEndpoints(discoveryResult.endpoints || []);
      const scanLimitations = Array.isArray(discoveryResult.scanLimitations)
        ? discoveryResult.scanLimitations
        : [];
      const discoveryAudit = Array.isArray(discoveryResult.discoveryAudit)
        ? discoveryResult.discoveryAudit
        : [];
      const defenseSignals = [];
      const findings = [];
      const wafDetection = await this.runWafDetection(targetUrl);
      const wafDetected = Boolean(wafDetection?.detected);
      this.wafDetected = wafDetected;
      if (wafDetected) {
        const provider = wafDetection.provider || "Unknown WAF";
        const reason = `WAF DETECTED: ${provider}. Payload-based findings may reflect WAF behavior.`;
        defenseSignals.push({
          type: "WAF_DETECTED",
          provider,
          reason
        });
        scanLimitations.push({
          category: "API Security",
          phase: "payload_precheck",
          endpoint: targetUrl,
          method: "GET",
          status: "BLOCKED",
          errorCode: "WAF_DETECTED",
          reason
        });
      } else if (String(wafDetection?.status || "").toUpperCase() === "TOOL_NOT_INSTALLED") {
        scanLimitations.push({
          category: "API Security",
          phase: "payload_precheck",
          endpoint: targetUrl,
          method: "GET",
          status: "TOOL_NOT_INSTALLED",
          errorCode: "TOOL_NOT_INSTALLED",
          reason: "wafw00f is not installed. WAF pre-detection was skipped."
        });
      }

      await this.executionLogger.logTestExecution({
        engagementId: String(engagement._id),
        testId: buildTestId("discovery"),
        testName: "API Endpoint Discovery",
        tool: "VENOM API Scanner",
        category: "API Security",
        target: targetUrl,
        parameters: {
          targetUrl,
          endpointCount: discoveredEndpoints.length,
          sources: Array.from(new Set(discoveredEndpoints.map((item) => item.source || "probe"))),
          skippedCount: discoveryAudit.filter((item) => item.action === "skipped").length,
          limitationCount: scanLimitations.length
        },
        response: {
          statusCode: discoveredEndpoints.length > 0 ? 200 : 404,
          headers: {},
          bodySize: JSON.stringify(discoveredEndpoints).length
        },
        result: {
          status: "PASSED",
          confidence: 0.85,
          reason: `API scanner discovered ${discoveredEndpoints.length} valid URL(s) using status-validated endpoint discovery.`,
          severity: "info"
        },
        executionTimeMs: 0,
        findingCount: 0
      });

      if (discoveredEndpoints.length === 0) {
        findings.push(this.buildFinding({
          idPrefix: "api",
          type: "API_NO_ENDPOINTS_DISCOVERED",
          title: "API Endpoint Discovery Failed",
          description: "No functional API endpoints could be discovered via OpenAPI specs, common paths, or crawling. API security checks could not be comprehensively performed.",
          severity: "info",
          endpoint: targetUrl,
          methodTested: "GET",
          testPerformed: "Probed common API paths and analyzed root HTML for links.",
          responseObserved: "All probes returned 404, 403, or non-API responses.",
          remediation: "Ensure the target has an OpenAPI specification at a standard path (e.g., /openapi.json) or provide explicit API endpoint lists."
        }));
      }

      for (const endpoint of discoveredEndpoints) {
        // eslint-disable-next-line no-await-in-loop
        const missingAuthFinding = await this.runMissingAuthTest(
          targetUrl,
          endpoint,
          String(engagement._id)
        );
        if (missingAuthFinding) {
          findings.push(missingAuthFinding);
        }

        // eslint-disable-next-line no-await-in-loop
        const bolaFinding = await this.runBolaTest(targetUrl, endpoint, String(engagement._id));
        if (bolaFinding) {
          findings.push(bolaFinding);
        }

        // eslint-disable-next-line no-await-in-loop
        const rateLimitFinding = await this.runRateLimitTest(
          targetUrl,
          endpoint,
          String(engagement._id),
          { defenseSignals }
        );
        if (rateLimitFinding) {
          findings.push(rateLimitFinding);
        }

        // eslint-disable-next-line no-await-in-loop
        const inputValidationFindings = await this.runInputValidationTest(
          targetUrl,
          endpoint,
          String(engagement._id),
          { wafDetected }
        );
        findings.push(...inputValidationFindings);
      }

      const graphqlFinding = await this.checkGraphQLIntrospection(
        targetUrl,
        String(engagement._id)
      );
      if (graphqlFinding) {
        findings.push(graphqlFinding);
      }

      logger.info(
        {
          engagementId,
          targetUrl,
          endpoints: discoveredEndpoints.length,
          findings: findings.length
        },
        "API security scan complete"
      );

      return {
        status: "SUCCESS",
        findings,
        scannedEndpoints: discoveredEndpoints,
        endpointCount: discoveredEndpoints.length,
        probedUrlCount: discoveredEndpoints.length,
        scanLimitations,
        discoveryAudit,
        defenseSignals,
        wafDetection,
        durationMs: Date.now() - scanStartedAt
      };
    } catch (error) {
      logError(logger, { engagementId }, "API security scan failed", error);
      const structuredError = createStructuredError(error);
      return {
        ...structuredError,
        findings: [],
        scannedEndpoints: [],
        scanLimitations: [],
        discoveryAudit: [],
        defenseSignals: [],
        wafDetection: null,
        error: structuredError.message
      };
    }
  }
}

module.exports = new ApiSecurityService();




