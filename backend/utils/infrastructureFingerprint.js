function asString(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (!normalizedKey) continue;
    out[normalizedKey] = asString(value);
  }
  return out;
}

function detectChallengeSignals(headers = {}, body = "") {
  const normalizedBody = asString(body).toLowerCase();
  const hasJsChallenge =
    normalizedBody.includes("checking your browser") ||
    normalizedBody.includes("cf-browser-verification") ||
    normalizedBody.includes("jschl-answer") ||
    normalizedBody.includes("attention required");
  const hasCaptcha =
    normalizedBody.includes("captcha") ||
    normalizedBody.includes("hcaptcha") ||
    normalizedBody.includes("recaptcha");
  const hasBotSignals =
    normalizedBody.includes("bot") ||
    normalizedBody.includes("automated traffic") ||
    normalizedBody.includes("verify you are human") ||
    Object.keys(headers).some((key) => key.includes("bot"));

  return {
    jsChallenge: hasJsChallenge,
    captcha: hasCaptcha,
    botManager: hasBotSignals
  };
}

function detectInfrastructureFingerprint({ headers = {}, body = "", targetUrl = "" } = {}) {
  const normalizedHeaders = normalizeHeaders(headers);
  const bodyText = asString(body).toLowerCase();
  const server = String(normalizedHeaders.server || "").toLowerCase();

  const waf = new Set();
  const cdn = new Set();
  const hosting = new Set();
  const appStack = new Set();
  const evidence = [];

  const addEvidence = (label, reason) => {
    evidence.push({ label, reason });
  };

  if (server.includes("cloudflare") || normalizedHeaders["cf-ray"]) {
    waf.add("Cloudflare");
    cdn.add("Cloudflare");
    addEvidence("Cloudflare", "Detected via server/cf-ray headers.");
  }
  if (
    normalizedHeaders["x-akamai-request-id"] ||
    normalizedHeaders["x-akamai-transformed"] ||
    server.includes("akamai")
  ) {
    waf.add("Akamai");
    cdn.add("Akamai");
    addEvidence("Akamai", "Detected via Akamai response headers.");
  }
  if (
    server.includes("fastly") ||
    normalizedHeaders["x-served-by"]?.toLowerCase().includes("cache-") ||
    normalizedHeaders["fastly-debug-digest"]
  ) {
    cdn.add("Fastly");
    addEvidence("Fastly", "Detected via Fastly cache headers.");
  }
  if (
    normalizedHeaders["x-iinfo"] ||
    normalizedHeaders["x-cdn"]?.toLowerCase().includes("incapsula") ||
    normalizedHeaders["set-cookie"]?.toLowerCase().includes("incap_ses")
  ) {
    waf.add("Imperva");
    addEvidence("Imperva", "Detected via Incapsula/Imperva headers or cookies.");
  }
  if (normalizedHeaders["x-sucuri-id"] || normalizedHeaders["x-sucuri-cache"] || server.includes("sucuri")) {
    waf.add("Sucuri");
    addEvidence("Sucuri", "Detected via Sucuri WAF response headers.");
  }
  if (normalizedHeaders["x-amzn-trace-id"] && normalizedHeaders["x-cache"]) {
    waf.add("AWS WAF");
    addEvidence("AWS WAF", "Detected AWS edge/WAF-like headers in response.");
  }
  if (normalizedHeaders["x-amzn-trace-id"] || server.includes("awselb")) {
    hosting.add("AWS ALB");
    addEvidence("AWS ALB", "Detected via x-amzn-trace-id/server header.");
  }
  if (
    normalizedHeaders["x-amz-cf-id"] ||
    normalizedHeaders["x-edge-result-type"] ||
    server.includes("cloudfront")
  ) {
    hosting.add("CloudFront");
    cdn.add("CloudFront");
    addEvidence("CloudFront", "Detected via CloudFront edge/cache headers.");
  }
  if (normalizedHeaders["x-vercel-id"] || server.includes("vercel") || normalizedHeaders["x-nextjs-cache"])
  {
    hosting.add("Vercel");
    addEvidence("Vercel", "Detected via x-vercel-id/server header.");
  }
  if (normalizedHeaders["x-nf-request-id"] || server.includes("netlify")) {
    hosting.add("Netlify");
    addEvidence("Netlify", "Detected via Netlify request headers.");
  }
  if (normalizedHeaders["x-render-server-id"] || server.includes("render")) {
    hosting.add("Render");
    addEvidence("Render", "Detected via Render server headers.");
  }
  if (normalizedHeaders["x-railway-id"] || server.includes("railway")) {
    hosting.add("Railway");
    addEvidence("Railway", "Detected via Railway headers.");
  }
  if (server.includes("firebase") || normalizedHeaders["x-firebase-host"]) {
    hosting.add("Firebase");
    addEvidence("Firebase", "Detected via Firebase hosting headers.");
  }
  if (server.includes("traefik")) {
    hosting.add("Traefik");
    addEvidence("Traefik", "Detected via Traefik server header.");
  }
  if (server.includes("envoy")) {
    hosting.add("Envoy");
    addEvidence("Envoy", "Detected via Envoy server header.");
  }
  if (server.includes("haproxy")) {
    hosting.add("HAProxy");
    addEvidence("HAProxy", "Detected via HAProxy server header.");
  }
  if (server.includes("bunny") || normalizedHeaders["x-bunny"] || normalizedHeaders["x-bunny-cache"]) {
    cdn.add("Bunny");
    addEvidence("Bunny", "Detected via Bunny edge headers.");
  }
  if (server.includes("nginx")) {
    hosting.add("Nginx");
    addEvidence("Nginx", "Detected via server header.");
  }
  if (server.includes("apache")) {
    hosting.add("Apache");
    addEvidence("Apache", "Detected via server header.");
  }
  if (normalizedHeaders["x-powered-by"]?.toLowerCase().includes("express")) {
    appStack.add("Express");
    addEvidence("Express", "Detected via X-Powered-By header.");
  }
  if (
    bodyText.includes("__next") ||
    bodyText.includes("next/static") ||
    bodyText.includes("\"next\"")
  ) {
    appStack.add("Next.js");
    appStack.add("React");
    addEvidence("Next.js", "Detected via __next/next-static markers.");
  } else if (bodyText.includes("react")) {
    appStack.add("React");
    addEvidence("React", "Detected via client-side React markers.");
  }
  if (bodyText.includes("wp-content") || bodyText.includes("wp-includes")) {
    appStack.add("WordPress");
    addEvidence("WordPress", "Detected via wp-content/wp-includes markers.");
  }
  if (bodyText.includes("laravel") || normalizedHeaders["x-powered-by"]?.toLowerCase().includes("laravel")) {
    appStack.add("Laravel");
    addEvidence("Laravel", "Detected via body or header fingerprint.");
  }

  if (normalizedHeaders["x-cache"] || normalizedHeaders["cf-cache-status"]) {
    addEvidence(
      "CDN Edge Cache",
      "Cache response headers detected; route behavior may be influenced by edge normalization."
    );
  }

  const defenseSignals = detectChallengeSignals(normalizedHeaders, bodyText);
  if (defenseSignals.jsChallenge) {
    addEvidence("JS Challenge", "Challenge-page markers observed in response body.");
  }
  if (defenseSignals.captcha) {
    addEvidence("CAPTCHA", "CAPTCHA markers observed in response body.");
  }
  if (defenseSignals.botManager) {
    addEvidence("Bot Manager", "Bot-defense markers observed in body or headers.");
  }

  const evidenceCount = evidence.length;
  const confidence = evidenceCount >= 3 ? "HIGH" : evidenceCount === 2 ? "MEDIUM" : "LOW";

  return {
    targetUrl,
    serverHeader: normalizedHeaders.server || "",
    xPoweredBy: normalizedHeaders["x-powered-by"] || "",
    waf: [...waf],
    cdn: [...cdn],
    hosting: [...hosting],
    appStack: [...appStack],
    defenseSignals,
    edgeCache:
      Boolean(normalizedHeaders["x-cache"]) || Boolean(normalizedHeaders["cf-cache-status"]),
    confidence,
    evidence
  };
}

module.exports = {
  detectInfrastructureFingerprint
};
