const OWASP_TOP_10_2021 = {
  A01: {
    name: "Broken Access Control",
    tags: ["idor", "auth", "privilege-escalation"]
  },
  A02: {
    name: "Cryptographic Failures",
    tags: ["tls", "information-disclosure"]
  },
  A03: {
    name: "Injection",
    tags: ["sqli", "xss", "rce", "lfi", "rfi", "ssrf"]
  },
  A04: {
    name: "Insecure Design",
    tags: ["design", "misconfiguration"]
  },
  A05: {
    name: "Security Misconfiguration",
    tags: ["web", "cloud", "container", "api", "header-hardening"]
  },
  A06: {
    name: "Vulnerable and Outdated Components",
    tags: ["cms", "known-cve", "deserialization"]
  },
  A07: {
    name: "Identification and Authentication Failures",
    tags: ["auth"]
  },
  A08: {
    name: "Software and Data Integrity Failures",
    tags: ["deserialization", "api"]
  },
  A09: {
    name: "Security Logging and Monitoring Failures",
    tags: ["logging"]
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
    tags.add("web");
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
  metadataTags.forEach((tag) => tags.add(normalizeText(tag)));

  return [...tags].filter(Boolean);
}

function mapFindingsToOwasp(findings = []) {
  const owaspMap = {};

  for (const finding of findings) {
    const findingTags = extractFindingTags(finding);
    const description = normalizeText(finding.description);

    for (const [code, owasp] of Object.entries(OWASP_TOP_10_2021)) {
      const matched = owasp.tags.some(
        (tag) => findingTags.includes(tag) || description.includes(tag)
      );
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
  if (!Array.isArray(findings) || findings.length === 0) {
    return 0;
  }

  const scores = findings
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
  const avgScore =
    scores.reduce((acc, value) => acc + value, 0) / Math.max(scores.length, 1);
  const blended = maxScore * 0.7 + avgScore * 0.3;
  return Number(Math.min(10, blended).toFixed(2));
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

