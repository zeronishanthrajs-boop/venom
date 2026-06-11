const RATE_LIMIT_HEADER_NAMES = new Set([
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-rate-limit-limit",
  "x-rate-limit-remaining",
  "x-rate-limit-reset",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "retry-after"
]);

const WAF_SIGNATURES = [
  {
    provider: "Cloudflare",
    headerMatchers: [
      ["server", /cloudflare/i],
      ["cf-ray", /.+/i],
      ["cf-cache-status", /.+/i]
    ],
    bodyMatchers: [/cf-browser-verification/i, /checking your browser/i, /cloudflare ray id/i]
  },
  {
    provider: "AWS WAF",
    headerMatchers: [["x-amzn-requestid", /.+/i], ["x-amz-cf-id", /.+/i]],
    bodyMatchers: [/aws.?waf/i, /request blocked/i]
  },
  {
    provider: "Akamai",
    headerMatchers: [["server", /akamai/i], ["akamai-grn", /.+/i]],
    bodyMatchers: [/akamai/i, /reference #[a-z0-9.]+/i]
  },
  {
    provider: "Imperva",
    headerMatchers: [["x-iinfo", /.+/i], ["server", /imperva|incapsula/i]],
    bodyMatchers: [/incapsula/i, /imperva/i]
  },
  {
    provider: "Sucuri",
    headerMatchers: [["server", /sucuri/i], ["x-sucuri-id", /.+/i]],
    bodyMatchers: [/sucuri website firewall/i]
  },
  {
    provider: "Fastly",
    headerMatchers: [["x-served-by", /cache-/i], ["x-cache", /fastly|hit|miss/i]],
    bodyMatchers: [/fastly error/i]
  },
  {
    provider: "Azure Front Door",
    headerMatchers: [["x-azure-ref", /.+/i], ["server", /azure.?front.?door/i]],
    bodyMatchers: [/azure front door/i]
  }
];

const CONFIDENCE_TO_SCORE = {
  CONFIRMED: 100,
  STRONG_SIGNAL: 82,
  LIKELY: 82,
  WEAK_SIGNAL: 52,
  WEAK: 52,
  INFORMATIONAL: 35,
  THEORETICAL: 35,
  UNVERIFIED: 25,
  CDN_INFLUENCED: 45
};

function normalizeHeaderName(name) {
  return String(name || "").trim().toLowerCase();
}

function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    normalized[normalizeHeaderName(key)] = Array.isArray(value) ? value.join(", ") : String(value || "");
  }
  return normalized;
}

function getHeader(headers, name) {
  return normalizeHeaders(headers)[normalizeHeaderName(name)] || "";
}

function bodyText(value) {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function extractEvidenceResponse(finding = {}) {
  return finding?.evidence?.response || finding?.metadata?.response || finding?.response || {};
}

function extractStatusCode(finding = {}) {
  const response = extractEvidenceResponse(finding);
  return Number(
    response.statusCode ||
      response.status ||
      finding.statusCode ||
      finding.status ||
      finding?.metadata?.statusCode ||
      0
  );
}

function extractBody(finding = {}) {
  const response = extractEvidenceResponse(finding);
  return bodyText(
    response.body ||
      response.bodyExcerpt ||
      finding.body ||
      finding.responseBody ||
      finding?.metadata?.body ||
      ""
  );
}

function extractHeaders(finding = {}) {
  const response = extractEvidenceResponse(finding);
  return normalizeHeaders(response.headers || finding.headers || finding?.metadata?.headers || {});
}

function isRateLimitFinding(finding = {}) {
  const haystack = [
    finding.type,
    finding.category,
    finding.title,
    finding.description,
    finding.recommendation,
    finding?.metadata?.findingType,
    finding?.metadata?.vulnerabilityClass
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /rate.?limit|throttl|request.?limit|brute.?force/.test(haystack);
}

function detectWafFromSignals({ headers = {}, body = "", statusCode = 0 } = {}) {
  const normalizedHeaders = normalizeHeaders(headers);
  const text = bodyText(body);
  const providers = [];
  const evidence = [];

  for (const signature of WAF_SIGNATURES) {
    const headerMatched = signature.headerMatchers.some(([header, pattern]) =>
      pattern.test(normalizedHeaders[header] || "")
    );
    const bodyMatched = signature.bodyMatchers.some((pattern) => pattern.test(text));
    if (headerMatched || bodyMatched) {
      providers.push(signature.provider);
      evidence.push({
        provider: signature.provider,
        matched: headerMatched && bodyMatched ? "headers_and_body" : headerMatched ? "headers" : "body"
      });
    }
  }

  const challengePage =
    /captcha|access denied|request blocked|security check|browser verification|just a moment/i.test(text) &&
    [403, 429, 503].includes(Number(statusCode || 0));
  if (challengePage && providers.length === 0) {
    providers.push("Generic WAF/Bot Defense");
    evidence.push({ provider: "Generic WAF/Bot Defense", matched: "challenge_page" });
  }

  return {
    detected: providers.length > 0,
    providers: [...new Set(providers)],
    evidence
  };
}

function classifyResponseMeaning({ statusCode = 0, headers = {}, body = "" } = {}) {
  const status = Number(statusCode || 0);
  const location = getHeader(headers, "location");
  const waf = detectWafFromSignals({ headers, body, statusCode: status });

  if (waf.detected) {
    return {
      meaning: "WAF_ACTIVE",
      protected: true,
      reason: `Response matches WAF/bot-defense signature (${waf.providers.join(", ")}).`,
      waf
    };
  }
  if (status === 403) {
    return {
      meaning: "BLOCKED_OR_PROTECTED",
      protected: true,
      reason: "HTTP 403 indicates the request was blocked or protected, not accepted without controls.",
      waf
    };
  }
  if (status === 401) {
    return {
      meaning: "AUTH_REQUIRED",
      protected: true,
      reason: "HTTP 401 indicates authentication is required.",
      waf
    };
  }
  if ([301, 302, 303, 307, 308].includes(status) && /login|signin|auth|session/i.test(location)) {
    return {
      meaning: "AUTH_REDIRECT",
      protected: true,
      reason: `HTTP ${status} redirects to an authentication flow.`,
      waf
    };
  }
  if (status === 404) {
    const generic404 = /not found|404|page could not be found/i.test(bodyText(body));
    return {
      meaning: generic404 ? "NOT_PRESENT" : "HIDDEN_OR_NOT_FOUND",
      protected: false,
      reason: generic404
        ? "HTTP 404 with generic not-found body indicates the endpoint is not present."
        : "HTTP 404 with a non-generic body is inconclusive and should not support rate-limit claims alone.",
      waf
    };
  }
  return {
    meaning: "UNCLASSIFIED",
    protected: false,
    reason: "No protective response signature matched.",
    waf
  };
}

function hasRateLimitHeaders(headers = {}) {
  const normalized = normalizeHeaders(headers);
  return Object.keys(normalized).some((name) => RATE_LIMIT_HEADER_NAMES.has(name));
}

function everyStatus2xx(statuses = []) {
  return statuses.length > 0 && statuses.every((status) => Number(status) >= 200 && Number(status) < 300);
}

function noBehavioralChange(rateLimitProbe = {}) {
  const diff = rateLimitProbe.responseDiff || {};
  const latencyRatio = Number(rateLimitProbe.latencyRatio || diff.durationChangeRatio || 1);
  return (
    !diff.statusChanged &&
    !diff.bodyChanged &&
    !diff.redirectChanged &&
    !diff.retryAfterIntroduced &&
    latencyRatio < 2 &&
    !rateLimitProbe.challengeDetected &&
    Number(rateLimitProbe.networkResets || 0) === 0
  );
}

function evaluateRateLimitProtocol(finding = {}) {
  const response = extractEvidenceResponse(finding);
  const headers = extractHeaders(finding);
  const rateLimitProbe = finding?.evidence?.rateLimitProbe || finding?.metadata?.rateLimitProbe || {};
  const statuses = Array.isArray(rateLimitProbe.statusCodesByRequest)
    ? rateLimitProbe.statusCodesByRequest.map(Number)
    : [];
  const statusCode = extractStatusCode(finding);
  const statusSeries = statuses.length > 0 ? statuses : statusCode ? [statusCode] : [];
  const signals = [];
  const contradictions = [];

  if (everyStatus2xx(statusSeries) && statusSeries.length >= 20) {
    signals.push("20 sequential requests remained consistently 2xx.");
  } else {
    contradictions.push("Responses were not consistently 2xx across the full 20-request sequence.");
  }

  if (!hasRateLimitHeaders(headers) && !hasRateLimitHeaders(response.headers || {})) {
    signals.push("No token-bucket or Retry-After headers were observed.");
  } else {
    contradictions.push("Rate-limit or retry headers were observed.");
  }

  if (noBehavioralChange(rateLimitProbe)) {
    signals.push("No response-time, body-size, content, redirect, or challenge behavior changed.");
  } else {
    contradictions.push("Behavior changed during the request sequence.");
  }

  if (rateLimitProbe.explicitBlocking === true) contradictions.push("Explicit blocking was detected.");
  if (rateLimitProbe.silentThrottling === true) contradictions.push("Silent throttling was detected.");
  if (rateLimitProbe.adaptiveDefense === true) contradictions.push("Adaptive edge defense was detected.");

  return {
    passes: signals.length >= 3 && contradictions.length === 0,
    signals,
    contradictions
  };
}

function normalizeConfidenceScore(finding = {}) {
  const explicit = Number(finding.confidenceScore || finding?.metadata?.confidenceScore);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return Math.max(0, Math.min(100, Math.round(explicit)));
  }
  const confidence = String(
    finding.confidence ||
      finding.detectionConfidence ||
      finding.exploitConfidence ||
      finding?.metadata?.confidence ||
      ""
  )
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  return CONFIDENCE_TO_SCORE[confidence] || 70;
}

class ResponseIntelligenceEngine {
  constructor({ learnedSignatures = [] } = {}) {
    this.learnedSignatures = Array.isArray(learnedSignatures) ? learnedSignatures : [];
  }

  addLearnedSignature(signature) {
    if (signature && typeof signature === "object") {
      this.learnedSignatures.push(signature);
    }
  }

  analyzeFinding(finding = {}, context = {}) {
    const statusCode = extractStatusCode(finding);
    const headers = extractHeaders(finding);
    const body = extractBody(finding);
    const responseMeaning = classifyResponseMeaning({ statusCode, headers, body });
    const contextWaf = context?.infrastructureFingerprint?.waf || context?.wafDetection?.provider;
    const wafProviders = [
      ...responseMeaning.waf.providers,
      ...(Array.isArray(contextWaf) ? contextWaf : contextWaf ? [contextWaf] : [])
    ].filter(Boolean);
    const reasons = [responseMeaning.reason];
    let confidenceScore = normalizeConfidenceScore(finding);
    let suppressed = false;
    let suppressionReason = "";

    if (isRateLimitFinding(finding)) {
      const protocol = evaluateRateLimitProtocol(finding);
      reasons.push(...protocol.signals, ...protocol.contradictions);

      if (responseMeaning.protected || wafProviders.length > 0) {
        suppressed = true;
        suppressionReason =
          "Missing-rate-limit finding suppressed because the endpoint returned a protective/auth/WAF response.";
        confidenceScore = Math.min(confidenceScore, 25);
      } else if (!protocol.passes) {
        suppressed = true;
        suppressionReason =
          "Missing-rate-limit finding suppressed because fewer than three corroborating no-throttle signals were present.";
        confidenceScore = Math.min(confidenceScore, 45);
      } else {
        confidenceScore = Math.max(confidenceScore, 82);
      }
    }

    if (!suppressed && confidenceScore < 60) {
      suppressed = true;
      suppressionReason = "Finding suppressed from default report view because confidence is below 60.";
    }

    const intelligence = {
      responseMeaning: responseMeaning.meaning,
      confidenceScore,
      wafDetected: wafProviders.length > 0,
      wafProviders: [...new Set(wafProviders)],
      reasoning: reasons.filter(Boolean),
      suppressed,
      suppressionReason
    };

    return {
      finding: {
        ...finding,
        confidenceScore,
        metadata: {
          ...(finding.metadata || {}),
          responseIntelligence: intelligence
        }
      },
      suppressed,
      intelligence
    };
  }

  async processFindings(findings = [], context = {}) {
    const visibleFindings = [];
    const suppressedFindings = [];
    const auditLog = [];

    for (const finding of Array.isArray(findings) ? findings : []) {
      const analysis = this.analyzeFinding(finding, context);
      auditLog.push({
        title: finding?.title || "",
        type: finding?.type || finding?.metadata?.findingType || "",
        endpoint: finding?.endpoint || finding?.metadata?.endpoint || "",
        ...analysis.intelligence
      });
      if (analysis.suppressed) {
        suppressedFindings.push({
          ...analysis.finding,
          suppressedAt: new Date().toISOString(),
          suppressionReason: analysis.intelligence.suppressionReason
        });
      } else {
        visibleFindings.push(analysis.finding);
      }
    }

    return {
      findings: visibleFindings,
      suppressedFindings,
      auditLog
    };
  }
}

module.exports = {
  ResponseIntelligenceEngine,
  responseIntelligenceEngine: new ResponseIntelligenceEngine(),
  classifyResponseMeaning,
  detectWafFromSignals,
  evaluateRateLimitProtocol,
  isRateLimitFinding
};
