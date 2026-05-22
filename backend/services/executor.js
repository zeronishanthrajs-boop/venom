const dns = require("node:dns/promises");
const tls = require("node:tls");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { URL } = require("node:url");
const { getTool } = require("../tooling/toolRegistry");
const { executeRealTool } = require("../tooling/realTools");
const {
  analyzeHeaderFindings,
  detectTechnologyFingerprint
} = require("../tooling/vulnerabilityFeed");
const { logger } = require("../config/logger");
const { createNotApplicableResult } = require("../utils/scanErrors");

const execFileAsync = promisify(execFile);
const SENSITIVE_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy"
];
const EVIDENCE_HEADER_EXCLUSIONS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-internal-token",
  "x-venom-internal-token"
]);

function asPlainText(value) {
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

function sanitizeHeadersForEvidence(headers = {}) {
  const safeHeaders = {};
  for (const [rawKey, rawValue] of Object.entries(headers || {})) {
    const key = String(rawKey || "").trim().toLowerCase();
    if (!key || EVIDENCE_HEADER_EXCLUSIONS.has(key)) {
      continue;
    }
    safeHeaders[key] = asPlainText(rawValue).slice(0, 400);
  }
  return safeHeaders;
}

function trimBodyExcerpt(body, maxLength = 200) {
  const text = asPlainText(body).replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.slice(0, maxLength);
}

function enrichHeaderFindingWithEvidence(finding, {
  requestUrl,
  requestMethod,
  requestHeaders,
  requestTimestamp,
  responseStatus,
  responseHeaders,
  responseTimeMs,
  responseBody
}) {
  const findingHeader = String(finding?.metadata?.header || "").toLowerCase();
  const presentHeaders = Object.keys(responseHeaders || {}).sort();
  const missingHeaderList = findingHeader ? [findingHeader] : [];
  const evidence = {
    request: {
      url: requestUrl,
      method: String(requestMethod || "GET").toUpperCase(),
      headers: sanitizeHeadersForEvidence(requestHeaders || {}),
      timestamp: requestTimestamp
    },
    response: {
      statusCode: Number(responseStatus || 0),
      headers: sanitizeHeadersForEvidence(responseHeaders || {}),
      responseTimeMs: Number(responseTimeMs || 0),
      bodyExcerpt: trimBodyExcerpt(responseBody, 200)
    },
    headerProbe: {
      presentHeaders,
      missingHeaders: missingHeaderList
    }
  };
  const discoveryVector =
    "HTTP header probe: GET request sent to target URL, response headers analyzed for security directives and header hardening coverage.";
  const reproductionSteps = [
    `curl -sS -D - -o /dev/null '${requestUrl}'`
  ];

  return {
    ...finding,
    evidence,
    discoveryVector,
    reproductionSteps,
    metadata: {
      ...(finding.metadata || {}),
      evidence,
      discoveryVector,
      reproductionSteps
    }
  };
}

function getTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function withTimeout(promise, timeoutMs, label) {
  const safeTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${safeTimeoutMs}ms`);
      error.code = "TOOL_TIMEOUT";
      reject(error);
    }, safeTimeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

async function fetchOnceWithTimeout(targetUrl, timeoutMs) {
  const safeTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000;

  if (typeof AbortController !== "undefined") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
    try {
      return await fetch(targetUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(
          `HTTP headers probe timed out after ${safeTimeoutMs}ms`
        );
        timeoutError.code = "TOOL_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  const signal = getTimeoutSignal(safeTimeoutMs);
  return withTimeout(
    fetch(targetUrl, {
      method: "GET",
      redirect: "manual",
      signal
    }),
    safeTimeoutMs,
    "HTTP headers probe"
  );
}

async function fetchWithTimeout(targetUrl, timeoutMs, maxRedirects = 3) {
  const safeTimeoutMs = Math.min(
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
    15000
  );
  let currentUrl = targetUrl;
  const redirectChain = [];

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchOnceWithTimeout(currentUrl, safeTimeoutMs);
    const location = response.headers.get("location");
    if (
      response.status >= 300 &&
      response.status < 400 &&
      location &&
      redirects < maxRedirects
    ) {
      const nextUrl = new URL(location, currentUrl).toString();
      redirectChain.push({ from: currentUrl, to: nextUrl, status: response.status });
      currentUrl = nextUrl;
      continue;
    }
    return { response, finalUrl: currentUrl, redirectChain };
  }

  return { response: await fetchOnceWithTimeout(currentUrl, safeTimeoutMs), finalUrl: currentUrl, redirectChain };
}

async function detectHttpsSupport(targetUrl, timeoutMs) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol === "https:") {
      return true;
    }
    const httpsCandidate = `https://${parsed.host}${parsed.pathname || "/"}${parsed.search || ""}`;
    const probe = await fetchOnceWithTimeout(
      httpsCandidate,
      Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 6000, 6000)
    );
    return Number(probe?.status || 0) > 0;
  } catch {
    return false;
  }
}

async function runHttpHeadersProbe(targetUrl, timeoutMs) {
  const requestMethod = "GET";
  const requestTimestamp = new Date().toISOString();
  const startedAt = Date.now();
  const { response, finalUrl, redirectChain } = await fetchWithTimeout(targetUrl, timeoutMs, 3);
  const responseTimeMs = Date.now() - startedAt;

  const responseBody = await response.text().catch((error) => {
    logger.warn(
      { targetUrl: finalUrl, error: error?.message || String(error), stack: error?.stack || "" },
      "HTTP headers probe could not read response body"
    );
    return "";
  });
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const httpsSupported = await detectHttpsSupport(finalUrl || targetUrl, timeoutMs);

  const missingRecommendedHeaders = SENSITIVE_HEADERS.filter(
    (header) =>
      !headers[header] &&
      !(header === "strict-transport-security" && !httpsSupported)
  );
  const technologyFingerprint = detectTechnologyFingerprint(headers, responseBody);
  const findings = analyzeHeaderFindings(headers, {
    httpsSupported,
    targetUrl: finalUrl || targetUrl
  }).map((finding) =>
    enrichHeaderFindingWithEvidence(finding, {
      requestUrl: finalUrl || targetUrl,
      requestMethod,
      requestHeaders: {},
      requestTimestamp,
      responseStatus: response.status,
      responseHeaders: headers,
      responseTimeMs,
      responseBody
    })
  );

  return {
    tool: "http_headers_probe",
    targetUrl,
    finalUrl,
    redirectChain,
    httpStatus: response.status,
    headers,
    responseBodyPreview: responseBody.slice(0, 1000),
    responseBodyLength: responseBody.length,
    responseTimeMs,
    httpsSupported,
    missingRecommendedHeaders,
    technologyFingerprint,
    findings
  };
}

async function runDnsLookupProbe(targetUrl, timeoutMs) {
  const parsed = new URL(targetUrl);
  const host = parsed.hostname;
  const safeTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000;
  const [lookupAll, resolve4, resolve6] = await Promise.allSettled([
    withTimeout(dns.lookup(host, { all: true }), safeTimeoutMs, "dns.lookup"),
    withTimeout(dns.resolve4(host), safeTimeoutMs, "dns.resolve4"),
    withTimeout(dns.resolve6(host), safeTimeoutMs, "dns.resolve6")
  ]);

  const lookupPayload =
    lookupAll.status === "fulfilled"
      ? lookupAll.value
      : { error: lookupAll.reason?.message || "lookup failed" };
  const resolve4Payload =
    resolve4.status === "fulfilled"
      ? resolve4.value
      : { error: resolve4.reason?.message || "resolve4 failed" };
  const resolve6Payload =
    resolve6.status === "fulfilled"
      ? resolve6.value
      : { error: resolve6.reason?.message || "resolve6 failed" };

  return {
    tool: "dns_lookup_probe",
    targetHost: host,
    lookup: lookupPayload,
    resolve4: resolve4Payload,
    resolve6: resolve6Payload,
    findings: []
  };
}

function runTlsMetadataProbe(targetUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    if (parsed.protocol === "http:") {
      resolve(
        createNotApplicableResult({
          reason: "TLS_NOT_APPLICABLE: Target uses HTTP, not HTTPS. TLS analysis requires an HTTPS endpoint.",
          requiredTarget: "an HTTPS endpoint",
          note: "TLS analysis was intentionally skipped for an HTTP target."
        })
      );
      return;
    }

    const port = parsed.port ? Number(parsed.port) : 443;
    const safeTimeoutMs = Math.min(
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000,
      10000
    );

    const socket = tls.connect(
      {
        host: parsed.hostname,
        port,
        servername: parsed.hostname,
        rejectUnauthorized: false
      },
      () => {
        const cert = socket.getPeerCertificate() || {};
        const payload = {
          tool: "tls_metadata_probe",
          targetHost: parsed.hostname,
          targetPort: port,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError || null,
          protocol: socket.getProtocol() || null,
          cipher: socket.getCipher() || null,
          certificate: {
            subject: cert.subject || null,
            issuer: cert.issuer || null,
            validFrom: cert.valid_from || null,
            validTo: cert.valid_to || null,
            subjectaltname: cert.subjectaltname || null,
            serialNumber: cert.serialNumber || null
          },
          findings: []
        };

        socket.end();
        resolve(payload);
      }
    );

    socket.setTimeout(safeTimeoutMs, () => {
      socket.destroy();
      const timeoutError = new Error(
        "TLS_HANDSHAKE_TIMEOUT: Could not complete TLS handshake within 10 seconds."
      );
      timeoutError.code = "TOOL_TIMEOUT";
      timeoutError.errorCode = "TLS_HANDSHAKE_TIMEOUT";
      reject(timeoutError);
    });

    socket.on("error", (error) => {
      reject(error);
    });
  });
}

async function runZapBaselinePassive(targetUrl, timeoutSeconds) {
  if (process.env.ENABLE_DOCKER_TOOLS !== "true") {
    const error = new Error(
      "Docker tool execution disabled. Set ENABLE_DOCKER_TOOLS=true to allow."
    );
    error.code = "DOCKER_DISABLED";
    throw error;
  }

  const args = [
    "run",
    "--rm",
    "-t",
    "ghcr.io/zaproxy/zaproxy:stable",
    "zap-baseline.py",
    "-t",
    targetUrl,
    "-m",
    "1",
    "-I"
  ];

  const { stdout, stderr } = await execFileAsync("docker", args, {
    timeout: timeoutSeconds * 1000,
    maxBuffer: 1024 * 1024 * 2
  });

  return {
    tool: "zap_baseline_passive",
    targetUrl,
    summary:
      "Passive baseline output captured. Review warning/fail sections before triage.",
    stdout,
    stderr,
    findings: []
  };
}

async function runTool(toolId, targetUrl) {
  const tool = getTool(toolId);
  if (!tool) {
    const error = new Error(`Unsupported tool: ${toolId}`);
    error.code = "UNKNOWN_TOOL";
    throw error;
  }

  const timeoutMs = tool.timeoutSeconds * 1000;

  if (toolId === "http_headers_probe") {
    return runHttpHeadersProbe(targetUrl, timeoutMs);
  }

  if (toolId === "tls_metadata_probe") {
    return runTlsMetadataProbe(targetUrl, timeoutMs);
  }

  if (toolId === "dns_lookup_probe") {
    return runDnsLookupProbe(targetUrl, timeoutMs);
  }

  if (toolId === "zap_baseline_passive") {
    return runZapBaselinePassive(targetUrl, tool.timeoutSeconds);
  }

  if (tool.mode === "docker-real") {
    return executeRealTool(toolId, targetUrl, tool.timeoutSeconds);
  }

  const error = new Error(`No executor registered for ${toolId}`);
  error.code = "UNIMPLEMENTED_TOOL";
  throw error;
}

module.exports = {
  runTool
};
