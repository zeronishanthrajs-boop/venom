const { deduplicateFindings } = require("../utils/deduplicateFindings");

const OWASP_TOP_10_2021 = {
  A01: {
    name: "Broken Access Control",
    tags: ["idor", "privilege-escalation", "auth-bypass"]
  },
  A02: {
    name: "Cryptographic Failures",
    tags: ["tls", "weak-crypto", "information-disclosure"]
  },
  A03: {
    name: "Injection",
    tags: ["sqli", "rce", "lfi", "rfi", "command-injection"]
  },
  A04: {
    name: "Insecure Design",
    tags: ["design-flaw", "logic-error"]
  },
  A05: {
    name: "Security Misconfiguration",
    tags: [
      "misconfiguration",
      "headers",
      "header-hardening",
      "csp",
      "cors",
      "cloud",
      "container",
      "default-credentials"
    ]
  },
  A06: {
    name: "Vulnerable and Outdated Components",
    tags: ["cms", "deserialization", "outdated-component", "known-cve"]
  },
  A07: {
    name: "Identification and Authentication Failures",
    tags: ["auth", "session", "credential-stuffing"]
  },
  A08: {
    name: "Software and Data Integrity Failures",
    tags: ["deserialization", "supply-chain"]
  },
  A09: {
    name: "Security Logging and Monitoring Failures",
    tags: ["logging-failure", "audit-gap"]
  },
  A10: {
    name: "Server-Side Request Forgery",
    tags: ["ssrf"]
  }
};

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function severityToCvssDefault(severity) {
  const normalized = normalizeText(severity);
  if (normalized === "critical") {
    return 9.4;
  }
  if (normalized === "high") {
    return 8.0;
  }
  if (normalized === "medium") {
    return 5.5;
  }
  if (normalized === "low") {
    return 3.1;
  }
  return 0;
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

  if (/csp|hsts|x-content-type-options|security header/.test(combined)) {
    tags.add("header-hardening");
    tags.add("headers");
    tags.add("csp");
    tags.add("misconfiguration");
  }
  if (/idor/.test(combined)) tags.add("idor");
  if (/auth|token|credential|session|password/.test(combined)) tags.add("auth");
  if (/sql|sqli|injection/.test(combined)) tags.add("sqli");
  if (/xss|cross-site scripting/.test(combined)) tags.add("xss");
  if (/ssrf/.test(combined)) tags.add("ssrf");
  if (/tls|ssl|certificate|cipher/.test(combined)) tags.add("tls");
  if (/dns|resolver|record/.test(combined)) tags.add("network");
  if (/wordpress|drupal|joomla|plugin|theme/.test(combined)) tags.add("cms");
  if (/cve-\d{4}-\d+/.test(combined) || finding.cve) tags.add("known-cve");

  const metadataTags = Array.isArray(finding?.metadata?.tags)
    ? finding.metadata.tags
    : [];
  const directTags = Array.isArray(finding?.tags) ? finding.tags : [];
  directTags.forEach((tag) => tags.add(normalizeText(tag)));
  metadataTags.forEach((tag) => tags.add(normalizeText(tag)));

  return [...tags].filter(Boolean);
}

function mapFindingsToOwasp(findings = []) {
  const owaspMap = {};
  const dedupedFindings = deduplicateFindings(findings);

  for (const finding of dedupedFindings) {
    const findingTags = extractFindingTags(finding);
    const title = normalizeText(finding.title);
    const description = normalizeText(finding.description);

    for (const [code, owasp] of Object.entries(OWASP_TOP_10_2021)) {
      const matched = owasp.tags.some((tag) => {
        const normalizedTag = normalizeText(tag);
        if (findingTags.includes(normalizedTag)) {
          return true;
        }
        if (normalizedTag.length <= 4) {
          return false;
        }
        return title.includes(normalizedTag) || description.includes(normalizedTag);
      });
      if (!matched) {
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
  const dedupedFindings = deduplicateFindings(findings);
  if (!Array.isArray(dedupedFindings) || dedupedFindings.length === 0) {
    return 0;
  }

  const scores = dedupedFindings
    .map((finding) => {
      if (typeof finding.cvssScore === "number") {
        return finding.cvssScore;
      }
      if (typeof finding?.metadata?.cvssScore === "number") {
        return finding.metadata.cvssScore;
      }
      return severityToCvssDefault(finding.severity);
    })
    .filter((value) => value > 0);

  if (scores.length === 0) {
    return 0;
  }

  const maxScore = Math.max(...scores);
  const modifier = maxScore >= 7 ? 1.05 : 1.0;
  return Number(Math.min(10, maxScore * modifier).toFixed(1));
}

function scoreToSeverity(score) {
  if (score >= 9) {
    return "CRITICAL";
  }
  if (score >= 7) {
    return "HIGH";
  }
  if (score >= 4) {
    return "MEDIUM";
  }
  return "LOW";
}

function generateComplianceSummary(findings = []) {
  const owaspCoverage = mapFindingsToOwasp(findings);
  const cvssOverallScore = computeOverallCvssScore(findings);
  const owaspCount = Object.keys(owaspCoverage).length;

  const remediationPriority = findings
    .map((finding) => ({
      ...finding,
      _derivedCvssScore:
        typeof finding.cvssScore === "number"
          ? finding.cvssScore
          : typeof finding?.metadata?.cvssScore === "number"
          ? finding.metadata.cvssScore
          : severityToCvssDefault(finding.severity)
    }))
    .sort((left, right) => right._derivedCvssScore - left._derivedCvssScore)
    .slice(0, 5)
    .map(({ _derivedCvssScore, ...item }) => ({
      ...item,
      cvssScore: Number(_derivedCvssScore.toFixed(2))
    }));

  return {
    cvssOverallScore,
    cvssSeverity: scoreToSeverity(cvssOverallScore),
    owaspCoverage: owaspCount,
    owaspBreakdown: owaspCoverage,
    owaspRating: owaspCount >= 5 ? "HIGH_RISK" : owaspCount >= 3 ? "MODERATE" : "LOW",
    remediationPriority
  };
}

module.exports = {
  mapFindingsToOwasp,
  computeOverallCvssScore,
  generateComplianceSummary,
  extractFindingTags
};
