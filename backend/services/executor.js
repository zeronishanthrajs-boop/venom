const dns = require("node:dns/promises");
const tls = require("node:tls");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { URL } = require("node:url");
const { getTool } = require("../tooling/toolRegistry");

const execFileAsync = promisify(execFile);
const SENSITIVE_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy"
];

function getTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

async function runHttpHeadersProbe(targetUrl, timeoutMs) {
  const response = await fetch(targetUrl, {
    method: "GET",
    redirect: "manual",
    signal: getTimeoutSignal(timeoutMs)
  });

  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const missingRecommendedHeaders = SENSITIVE_HEADERS.filter(
    (header) => !headers[header]
  );

  return {
    tool: "http_headers_probe",
    targetUrl,
    httpStatus: response.status,
    headers,
    missingRecommendedHeaders
  };
}

async function runDnsLookupProbe(targetUrl) {
  const parsed = new URL(targetUrl);
  const host = parsed.hostname;
  const [lookupAll, resolve4, resolve6] = await Promise.allSettled([
    dns.lookup(host, { all: true }),
    dns.resolve4(host),
    dns.resolve6(host)
  ]);

  return {
    tool: "dns_lookup_probe",
    targetHost: host,
    lookup:
      lookupAll.status === "fulfilled"
        ? lookupAll.value
        : { error: lookupAll.reason?.message || "lookup failed" },
    resolve4:
      resolve4.status === "fulfilled"
        ? resolve4.value
        : { error: resolve4.reason?.message || "resolve4 failed" },
    resolve6:
      resolve6.status === "fulfilled"
        ? resolve6.value
        : { error: resolve6.reason?.message || "resolve6 failed" }
  };
}

function runTlsMetadataProbe(targetUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const port = parsed.port ? Number(parsed.port) : 443;

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
            valid_from: cert.valid_from || null,
            valid_to: cert.valid_to || null,
            subjectaltname: cert.subjectaltname || null,
            serialNumber: cert.serialNumber || null
          }
        };

        socket.end();
        resolve(payload);
      }
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("TLS probe timed out"));
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
    stderr
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
    return runDnsLookupProbe(targetUrl);
  }

  if (toolId === "zap_baseline_passive") {
    return runZapBaselinePassive(targetUrl, tool.timeoutSeconds);
  }

  const error = new Error(`No executor registered for ${toolId}`);
  error.code = "UNIMPLEMENTED_TOOL";
  throw error;
}

module.exports = {
  runTool
};
