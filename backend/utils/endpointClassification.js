const CLASS_DEFINITIONS = [
  {
    endpointType: "AUTH_ENDPOINT",
    attackSurfaceCategory: "IDENTITY",
    exploitRelevance: "HIGH",
    sensitivity: "CRITICAL",
    weight: 1.5,
    rateLimitExpectation: "STRICT",
    keywords: [
      "login",
      "signin",
      "signup",
      "register",
      "password",
      "passwd",
      "oauth",
      "token",
      "session",
      "auth",
      "mfa",
      "otp",
      "client-login"
    ]
  },
  {
    endpointType: "ADMIN_PANEL",
    attackSurfaceCategory: "PRIVILEGED_CONTROL",
    exploitRelevance: "HIGH",
    sensitivity: "CRITICAL",
    weight: 1.45,
    rateLimitExpectation: "STRICT",
    keywords: ["admin", "dashboard", "manage", "control", "cms", "panel", "staff"]
  },
  {
    endpointType: "PAYMENT",
    attackSurfaceCategory: "TRANSACTIONAL",
    exploitRelevance: "HIGH",
    sensitivity: "HIGH",
    weight: 1.35,
    rateLimitExpectation: "STRICT",
    keywords: ["payment", "billing", "checkout", "invoice", "wallet", "payout", "txn"]
  },
  {
    endpointType: "USER_DATA",
    attackSurfaceCategory: "DATA_ACCESS",
    exploitRelevance: "HIGH",
    sensitivity: "HIGH",
    weight: 1.3,
    rateLimitExpectation: "STRICT",
    keywords: [
      "profile",
      "account",
      "user",
      "customer",
      "address",
      "phone",
      "email",
      "orders",
      "settings"
    ]
  },
  {
    endpointType: "FILE_UPLOAD",
    attackSurfaceCategory: "CONTENT_INGESTION",
    exploitRelevance: "HIGH",
    sensitivity: "HIGH",
    weight: 1.3,
    rateLimitExpectation: "STRICT",
    keywords: ["upload", "file", "attachment", "import", "media"]
  },
  {
    endpointType: "SEARCH",
    attackSurfaceCategory: "QUERY_INTERFACE",
    exploitRelevance: "MEDIUM",
    sensitivity: "MEDIUM",
    weight: 1.1,
    rateLimitExpectation: "STANDARD",
    keywords: ["search", "query", "lookup", "filter", "find"]
  },
  {
    endpointType: "API",
    attackSurfaceCategory: "PROGRAMMATIC_INTERFACE",
    exploitRelevance: "MEDIUM",
    sensitivity: "MEDIUM",
    weight: 1.0,
    rateLimitExpectation: "STANDARD",
    keywords: ["/api", "graphql", "rest", "rpc", "v1", "v2"]
  },
  {
    endpointType: "INTERNAL",
    attackSurfaceCategory: "OPERATIONAL_SURFACE",
    exploitRelevance: "MEDIUM",
    sensitivity: "HIGH",
    weight: 1.25,
    rateLimitExpectation: "STANDARD",
    keywords: ["internal", "private", "staging", "health", "metrics", "actuator", "debug"]
  },
  {
    endpointType: "BLOG_CONTENT",
    attackSurfaceCategory: "PUBLIC_CONTENT",
    exploitRelevance: "LOW",
    sensitivity: "LOW",
    weight: 0.7,
    rateLimitExpectation: "OPTIONAL",
    keywords: ["blog", "article", "news", "stories", "press", "testimonials"]
  },
  {
    endpointType: "STATIC_CONTENT",
    attackSurfaceCategory: "PUBLIC_CONTENT",
    exploitRelevance: "LOW",
    sensitivity: "LOW",
    weight: 0.65,
    rateLimitExpectation: "OPTIONAL",
    keywords: [
      "about",
      "pricing",
      "faq",
      "docs",
      "contact",
      "privacy",
      "terms",
      "sitemap",
      "robots",
      "assets",
      "static"
    ]
  }
];

const DEFAULT_CLASSIFICATION = {
  endpointType: "UNKNOWN",
  attackSurfaceCategory: "UNKNOWN",
  exploitRelevance: "MEDIUM",
  sensitivity: "MEDIUM",
  weight: 1.0,
  rateLimitExpectation: "STANDARD",
  matchedKeyword: "",
  reason:
    "Endpoint did not match known route signatures. Applied unknown-surface baseline context."
};

const LOW_SENSITIVITY_TYPES = new Set(["STATIC_CONTENT", "BLOG_CONTENT"]);
const STRICT_RATE_LIMIT_TYPES = new Set([
  "AUTH_ENDPOINT",
  "ADMIN_PANEL",
  "PAYMENT",
  "USER_DATA",
  "FILE_UPLOAD"
]);

function normalizeEndpointPath(endpoint = "") {
  const raw = String(endpoint || "").trim();
  if (!raw) {
    return "/";
  }
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname || "/"}${parsed.search || ""}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function tokenize(value = "") {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function inferLegacyEndpointType(endpointType = "UNKNOWN") {
  if (endpointType === "AUTH_ENDPOINT") return "AUTH";
  if (endpointType === "ADMIN_PANEL") return "ADMIN";
  if (endpointType === "STATIC_CONTENT" || endpointType === "BLOG_CONTENT") {
    return "INFORMATIONAL";
  }
  if (endpointType === "UNKNOWN") return "FUNCTIONAL";
  return "FUNCTIONAL";
}

function classifyEndpoint(endpoint = "") {
  const normalized = normalizeEndpointPath(endpoint);
  const tokens = tokenize(normalized);
  for (const definition of CLASS_DEFINITIONS) {
    for (const keyword of definition.keywords) {
      if (normalized.includes(keyword) || tokens.includes(keyword)) {
        return {
          endpointType: definition.endpointType,
          legacyEndpointType: inferLegacyEndpointType(definition.endpointType),
          attackSurfaceCategory: definition.attackSurfaceCategory,
          exploitRelevance: definition.exploitRelevance,
          sensitivity: definition.sensitivity,
          weight: definition.weight,
          rateLimitExpectation: definition.rateLimitExpectation,
          matchedKeyword: keyword,
          reason: `Classified as ${definition.endpointType} because endpoint matched keyword '${keyword}'.`
        };
      }
    }
  }
  return {
    ...DEFAULT_CLASSIFICATION,
    legacyEndpointType: inferLegacyEndpointType(DEFAULT_CLASSIFICATION.endpointType)
  };
}

function isLowSensitivityInformational(classification = {}) {
  const endpointType = String(classification.endpointType || "").toUpperCase();
  return LOW_SENSITIVITY_TYPES.has(endpointType);
}

function requiresStrictRateLimiting(classification = {}) {
  const endpointType = String(classification.endpointType || "").toUpperCase();
  if (STRICT_RATE_LIMIT_TYPES.has(endpointType)) {
    return true;
  }
  return String(classification.rateLimitExpectation || "").toUpperCase() === "STRICT";
}

module.exports = {
  classifyEndpoint,
  normalizeEndpointPath,
  isLowSensitivityInformational,
  requiresStrictRateLimiting
};
