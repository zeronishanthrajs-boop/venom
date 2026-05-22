const CLASS_DEFINITIONS = [
  {
    endpointType: "ADMIN",
    sensitivity: "CRITICAL",
    weight: 1.4,
    keywords: ["admin", "dashboard", "manage", "control", "cms", "panel", "staff"]
  },
  {
    endpointType: "AUTH",
    sensitivity: "HIGH",
    weight: 1.2,
    keywords: [
      "login",
      "signin",
      "signup",
      "register",
      "password",
      "oauth",
      "token",
      "session"
    ]
  },
  {
    endpointType: "FUNCTIONAL",
    sensitivity: "MEDIUM",
    weight: 1.0,
    keywords: ["search", "profile", "user", "comments", "products", "articles", "news"]
  },
  {
    endpointType: "INFORMATIONAL",
    sensitivity: "LOW",
    weight: 0.6,
    keywords: ["about", "faq", "robots", "rss", "feed", "sitemap", "contact"]
  }
];

const DEFAULT_CLASSIFICATION = {
  endpointType: "FUNCTIONAL",
  sensitivity: "MEDIUM",
  weight: 1.0,
  matchedKeyword: "",
  reason:
    "Endpoint did not match known authentication, administrative, or informational patterns. Applied functional baseline context."
};

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

function classifyEndpoint(endpoint = "") {
  const normalized = normalizeEndpointPath(endpoint);
  const tokens = tokenize(normalized);
  for (const definition of CLASS_DEFINITIONS) {
    for (const keyword of definition.keywords) {
      if (normalized.includes(keyword) || tokens.includes(keyword)) {
        return {
          endpointType: definition.endpointType,
          sensitivity: definition.sensitivity,
          weight: definition.weight,
          matchedKeyword: keyword,
          reason: `Classified as ${definition.endpointType} because endpoint matched keyword '${keyword}'.`
        };
      }
    }
  }
  return { ...DEFAULT_CLASSIFICATION };
}

module.exports = {
  classifyEndpoint,
  normalizeEndpointPath
};

