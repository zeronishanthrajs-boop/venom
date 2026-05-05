const { deduplicateFindings } = require("../utils/deduplicateFindings");

const OWASP_TOP_10_2021 = {
  A01: {
    name: "Broken Access Control",
    tags: ["idor", "privilege-escalation", "auth-bypass", "broken-access-control"],
    titleKeywords: ["access control", "unauthorized", "privilege escalation", "idor"]
  },
  A02: {
    name: "Cryptographic Failures",
    tags: ["tls", "weak-crypto", "ssl", "certificate"],
    titleKeywords: ["tls", "ssl", "certificate", "cryptograph", "encryption"]
  },
  A03: {
    name: "Injection",
    tags: ["sqli", "rce", "lfi", "rfi", "command-injection", "code-injection"],
    titleKeywords: ["sql injection", "remote code", "command injection", "lfi", "rfi"]
  },
  A04: {
    name: "Insecure Design",
    tags: ["design-flaw", "logic-error", "business-logic"],
    titleKeywords: ["insecure design", "logic flaw", "business logic"]
  },
  A05: {
    name: "Security Misconfiguration",
    tags: [
      "misconfiguration",
      "headers",
      "csp",
      "cors",
      "hsts",
      "x-frame",
      "default-credentials",
      "exposed-admin",
      "directory-listing",
      "header-hardening"
    ],
    titleKeywords: [
      "content-security-policy",
      "csp",
      "security header",
      "missing header",
      "cors",
      "hsts",
      "x-frame",
      "clickjack",
      "misconfigur",
      "exposed",
      "directory listing",
      "default password",
      "default credential"
    ]
  },
  A06: {
    name: "Vulnerable Components",
    tags: ["outdated-component", "vulnerable-library", "cve", "cms-vuln", "known-cve"],
    titleKeywords: ["outdated", "vulnerable version", "end of life", "deprecated"]
  },
  A07: {
    name: "Authentication Failures",
    tags: ["auth", "session", "credential-stuffing", "weak-password", "no-auth"],
    titleKeywords: ["authentication", "login", "session", "credential", "password"]
  },
  A08: {
    name: "Data Integrity Failures",
    tags: ["deserialization", "supply-chain", "integrity"],
    titleKeywords: ["deserializ", "integrity", "supply chain", "unsigned"]
  },
  A09: {
    name: "Security Logging Failures",
    tags: ["logging-failure", "no-logging", "audit-gap"],
    titleKeywords: ["logging", "monitoring", "audit trail"]
  },
  A10: {
    name: "SSRF",
    tags: ["ssrf", "server-side-request"],
    titleKeywords: ["ssrf", "server-side request"]
  }
};

const OWASP_EXCLUSIONS = {
  "content-security-policy": ["A01", "A02", "A03", "A04", "A06", "A07", "A08", "A09", "A10"],
  "missing header": ["A01", "A02", "A03", "A04", "A06", "A07", "A08", "A09", "A10"],
  "security header": ["A01", "A02", "A03", "A04", "A06", "A07", "A08", "A09", "A10"],
  csp: ["A01", "A02", "A03", "A04", "A06", "A07", "A08", "A09", "A10"],
  hsts: ["A01", "A02", "A03", "A04", "A06", "A07", "A08", "A09", "A10"],
  cors: ["A01", "A02", "A03", "A04", "A06", "A07", "A08", "A09", "A10"],
  "x-frame": ["A01", "A02", "A03", "A04", "A06", "A07", "A08", "A09", "A10"]
};

const SEVERITY_DEFAULT_CVSS = {
  CRITICAL: 9.0,
  HIGH: 7.5,
  MEDIUM: 5.0,
  LOW: 2.5,
  INFO: 0.5
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function extractFindingTags(finding = {}) {
  const tags = new Set();
  const category = normalizeText(finding.category);
  const title = normalizeText(finding.title);
  const description = normalizeText(finding.description);
  const combined = `${category} ${title} ${description}`;

  if (category) {
    tags.add(category);
  }

  if (/csp|hsts|x-content-type-options|security header|missing header/.test(combined)) {
    tags.add("header-hardening");
    tags.add("headers");
    tags.add("csp");
    tags.add("misconfiguration");
  }
  if (/idor/.test(combined)) tags.add("idor");
  if (/auth|token|credential|session|password/.test(combined)) tags.add("auth");
  if (/\bsqli?\b|sql[-_\s]*injection/.test(combined)) tags.add("sqli");
  if (/\bcommand\s+injection\b/.test(combined)) tags.add("command-injection");
  if (/rce|remote code execution/.test(combined)) tags.add("rce");
  if (/ssrf/.test(combined)) tags.add("ssrf");
  if (/tls|ssl|certificate|cipher/.test(combined)) tags.add("tls");
  if (/wordpress|drupal|joomla|plugin|theme/.test(combined)) tags.add("cms");
  if (/cve-\d{4}-\d+/.test(combined) || finding.cve) tags.add("cve");
  if (/misconfigur|default credential|directory listing|exposed/.test(combined)) {
    tags.add("misconfiguration");
  }

  const metadataTags = Array.isArray(finding?.metadata?.tags)
    ? finding.metadata.tags
    : [];
  const directTags = Array.isArray(finding?.tags) ? finding.tags : [];
  [...directTags, ...metadataTags]
    .map((tag) => normalizeText(tag))
    .filter(Boolean)
    .forEach((tag) => tags.add(tag));

  return [...tags];
}

function shouldExcludeCodeForTitle(code, titleLower) {
  for (const [keyword, excludedCodes] of Object.entries(OWASP_EXCLUSIONS)) {
    if (titleLower.includes(keyword) && excludedCodes.includes(code)) {
      return true;
    }
  }
  return false;
}

function mapFindingsToOwasp(findings = []) {
  const owaspMap = {};
  const dedupedFindings = deduplicateFindings(findings);

  for (const finding of dedupedFindings) {
    const findingTags = extractFindingTags(finding).map((tag) => tag.toLowerCase());
    const titleLower = normalizeText(finding.title);

    for (const [code, owasp] of Object.entries(OWASP_TOP_10_2021)) {
      if (shouldExcludeCodeForTitle(code, titleLower)) {
        continue;
      }

      const tagMatch = owasp.tags.some((tag) =>
        findingTags.includes(String(tag).toLowerCase())
      );
      const titleMatch = (owasp.titleKeywords || []).some((keyword) =>
        titleLower.includes(String(keyword).toLowerCase())
      );

      if (!tagMatch && !titleMatch) {
        continue;
      }

      if (!owaspMap[code]) {
        owaspMap[code] = {
          code,
          name: owasp.name,
          tags: owasp.tags,
          findings: []
        };
      }
      owaspMap[code].findings.push(finding);
    }
  }

  return owaspMap;
}

function computeOverallCvssScore(findings = []) {
  const deduped = deduplicateFindings(findings);
  if (!Array.isArray(deduped) || deduped.length === 0) {
    return 0;
  }

  const scores = deduped
    .map((finding) => {
      const direct = Number.parseFloat(finding?.cvssScore);
      if (Number.isFinite(direct) && direct > 0) {
        return direct;
      }
      const metadataCvss = Number.parseFloat(finding?.metadata?.cvssScore);
      if (Number.isFinite(metadataCvss) && metadataCvss > 0) {
        return metadataCvss;
      }
      const severityKey = String(finding?.severity || "INFO").toUpperCase();
      return SEVERITY_DEFAULT_CVSS[severityKey] ?? 0.5;
    })
    .filter((score) => Number.isFinite(score) && score > 0);

  if (scores.length === 0) {
    return 0;
  }

  const maxScore = Math.max(...scores);
  const modifier = maxScore >= 7.0 ? 1.05 : 1.0;
  return Math.min(10, Number.parseFloat((maxScore * modifier).toFixed(1)));
}

function scoreToSeverity(score) {
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  return "LOW";
}

function generateComplianceSummary(findings = []) {
  const deduped = deduplicateFindings(findings);
  const owaspCoverage = mapFindingsToOwasp(deduped);
  const cvssOverallScore = computeOverallCvssScore(deduped);
  const owaspCount = Object.keys(owaspCoverage).length;

  const remediationPriority = deduped
    .map((finding) => {
      const explicit = Number.parseFloat(finding.cvssScore);
      const severityDefault =
        SEVERITY_DEFAULT_CVSS[String(finding.severity || "INFO").toUpperCase()] ?? 0.5;
      return {
        ...finding,
        cvssScore:
          Number.isFinite(explicit) && explicit > 0
            ? explicit
            : Number(severityDefault.toFixed(1))
      };
    })
    .filter((finding) => Number(finding.cvssScore || 0) >= 5.0)
    .sort((a, b) => Number(b.cvssScore || 0) - Number(a.cvssScore || 0))
    .slice(0, 5);

  return {
    cvssOverallScore,
    cvssSeverity: scoreToSeverity(cvssOverallScore),
    owaspCoverage: owaspCount,
    owaspBreakdown: owaspCoverage,
    owaspRating:
      owaspCount >= 7 ? "CRITICAL" : owaspCount >= 5 ? "HIGH_RISK" : owaspCount >= 3 ? "MODERATE" : "LOW",
    remediationPriority
  };
}

module.exports = {
  mapFindingsToOwasp,
  computeOverallCvssScore,
  generateComplianceSummary,
  extractFindingTags
};
