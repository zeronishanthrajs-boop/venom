const crypto = require("node:crypto");

const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];

const ROOT_CAUSES = {
  RATE_LIMIT_ABSENT: "Rate Limiting Policy Absent",
  SECURITY_HEADER_MISSING: "Security Header Missing",
  SSL_TLS_WEAKNESS: "SSL/TLS Weakness",
  INJECTION_VECTOR: "Injection Vector",
  AUTH_WEAKNESS: "Authentication Weakness",
  IDOR_RISK: "IDOR Risk",
  INFO_DISCLOSURE: "Information Disclosure",
  CLOUD_MISCONFIGURATION: "Cloud Misconfiguration",
  SUPPLY_CHAIN_RISK: "Supply Chain Risk",
  SECRETS_EXPOSURE: "Secrets Exposure",
  OPEN_REDIRECT: "Open Redirect",
  SSRF_VECTOR: "SSRF Vector",
  CORS_MISCONFIGURATION: "CORS Misconfiguration",
  GENERIC_MISCONFIGURATION: "Generic Misconfiguration"
};

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSeverity(value) {
  const normalized = normalizeText(value).toLowerCase();
  return SEVERITY_ORDER.includes(normalized) ? normalized : "low";
}

function severityRank(value) {
  return SEVERITY_ORDER.indexOf(normalizeSeverity(value));
}

function escalateSeverity(baseSeverity, instanceCount) {
  const base = normalizeSeverity(baseSeverity);
  if (instanceCount >= 26) {
    return "critical";
  }
  const bump = instanceCount >= 11 ? 2 : instanceCount >= 4 ? 1 : 0;
  return SEVERITY_ORDER[Math.min(SEVERITY_ORDER.length - 1, severityRank(base) + bump)];
}

function findingHaystack(finding = {}) {
  return [
    finding.type,
    finding.category,
    finding.title,
    finding.description,
    finding.recommendation,
    finding.source,
    finding?.metadata?.findingType,
    finding?.metadata?.vulnerabilityClass,
    finding?.metadata?.rootCauseKey
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function classifyRootCause(finding = {}) {
  const text = findingHaystack(finding);
  if (/rate.?limit|throttl/.test(text)) return "RATE_LIMIT_ABSENT";
  if (/header|content-security-policy|hsts|x-frame-options|nosniff|referrer-policy|permissions-policy/.test(text)) return "SECURITY_HEADER_MISSING";
  if (/ssl|tls|certificate|cipher|https/.test(text)) return "SSL_TLS_WEAKNESS";
  if (/sql.?i|sql injection|xss|cross.?site|command injection|template injection|ldap|xpath|injection/.test(text)) return "INJECTION_VECTOR";
  if (/auth|login|session|jwt|password|bypass|unauth/.test(text)) return "AUTH_WEAKNESS";
  if (/idor|bola|object.?level|direct object/.test(text)) return "IDOR_RISK";
  if (/stack trace|version|debug|x-powered-by|information disclosure|info disclosure|server header/.test(text)) return "INFO_DISCLOSURE";
  if (/s3|bucket|metadata|iam|security group|cloud|aws|gcp|azure/.test(text)) return "CLOUD_MISCONFIGURATION";
  if (/dependency|package|supply chain|cve|outdated|vulnerable component|npm|pip/.test(text)) return "SUPPLY_CHAIN_RISK";
  if (/secret|token|api key|credential|password leak|private key/.test(text)) return "SECRETS_EXPOSURE";
  if (/open redirect|redirect parameter|redirect/.test(text)) return "OPEN_REDIRECT";
  if (/ssrf|server.?side request forgery|metadata endpoint/.test(text)) return "SSRF_VECTOR";
  if (/cors|cross-origin|access-control-allow-origin/.test(text)) return "CORS_MISCONFIGURATION";
  return "GENERIC_MISCONFIGURATION";
}

function affectedAsset(finding = {}) {
  return (
    normalizeText(finding.endpoint) ||
    normalizeText(finding.url) ||
    normalizeText(finding.path) ||
    normalizeText(finding?.metadata?.endpoint) ||
    normalizeText(finding?.metadata?.url) ||
    normalizeText(finding?.metadata?.path) ||
    normalizeText(finding?.evidence?.request?.url) ||
    "unknown"
  );
}

function affectedParameter(finding = {}) {
  return (
    normalizeText(finding.affectedParameter) ||
    normalizeText(finding.parameter) ||
    normalizeText(finding?.metadata?.affectedParameter) ||
    normalizeText(finding?.metadata?.parameter) ||
    normalizeText(finding?.metadata?.rootCauseKey) ||
    "global"
  ).toLowerCase();
}

function findingType(finding = {}) {
  return normalizeText(finding.type || finding?.metadata?.findingType || finding.category || finding.title).toLowerCase();
}

function buildFindingFingerprint(finding = {}, rootCauseId = classifyRootCause(finding)) {
  return crypto
    .createHash("sha256")
    .update(`${findingType(finding)}:${affectedParameter(finding)}:${rootCauseId}`)
    .digest("hex");
}

function confidenceScore(finding = {}) {
  const explicit = Number(finding.confidenceScore || finding?.metadata?.confidenceScore);
  if (Number.isFinite(explicit)) {
    return explicit;
  }
  const confidence = normalizeText(finding.confidence || finding.detectionConfidence).toUpperCase();
  if (confidence === "CONFIRMED") return 100;
  if (confidence === "STRONG_SIGNAL" || confidence === "LIKELY") return 82;
  if (confidence === "WEAK_SIGNAL" || confidence === "WEAK") return 52;
  return 70;
}

function pickRepresentative(findings = []) {
  return findings.slice().sort((left, right) => {
    const confidenceDelta = confidenceScore(right) - confidenceScore(left);
    if (confidenceDelta !== 0) return confidenceDelta;
    return severityRank(right.severity) - severityRank(left.severity);
  })[0] || {};
}

class FindingConsolidationEngine {
  consolidate(findings = []) {
    const rawFindings = Array.isArray(findings) ? findings.filter(Boolean) : [];
    const groups = new Map();
    const consolidationAudit = [];

    rawFindings.forEach((finding, index) => {
      const rootCauseId = classifyRootCause(finding);
      const parameter = affectedParameter(finding);
      const groupKey = `${rootCauseId}:${parameter}`;
      const fingerprint = buildFindingFingerprint(finding, rootCauseId);
      const asset = affectedAsset(finding);
      const seenAt = normalizeText(finding.firstSeen || finding.lastSeen || finding.createdAt) || new Date().toISOString();

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          rootCauseId,
          rootCauseLabel: ROOT_CAUSES[rootCauseId],
          affectedParameter: parameter,
          fingerprints: new Set(),
          instances: [],
          assets: new Set(),
          firstSeen: seenAt,
          lastSeen: seenAt
        });
      }

      const group = groups.get(groupKey);
      const duplicate = group.fingerprints.has(fingerprint);
      group.fingerprints.add(fingerprint);
      group.instances.push({
        ...finding,
        fingerprint,
        rootCauseId,
        affectedAsset: asset
      });
      group.assets.add(asset);
      group.firstSeen = new Date(group.firstSeen) <= new Date(seenAt) ? group.firstSeen : seenAt;
      group.lastSeen = new Date(group.lastSeen) >= new Date(seenAt) ? group.lastSeen : seenAt;

      consolidationAudit.push({
        action: duplicate ? "merged_duplicate_fingerprint" : "merged_into_root_cause",
        rawIndex: index,
        fingerprint,
        rootCauseId,
        affectedParameter: parameter,
        affectedAsset: asset,
        groupKey
      });
    });

    const consolidatedFindings = Array.from(groups.values()).map((group, index) => {
      const representative = pickRepresentative(group.instances);
      const instanceCount = group.instances.length;
      const severity = escalateSeverity(representative.severity, instanceCount);
      const affectedAssets = Array.from(group.assets).filter(Boolean).sort();

      return {
        ...representative,
        id: representative.id || `RC-${index + 1}`,
        title: `${group.rootCauseLabel}${affectedAssets.length > 1 ? ` across ${affectedAssets.length} assets` : ""}`,
        severity,
        rootCauseId: group.rootCauseId,
        rootCauseLabel: group.rootCauseLabel,
        affectedParameter: group.affectedParameter,
        instanceCount,
        affectedAssets,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
        representative,
        allInstances: group.instances,
        deduplicationFingerprint: buildFindingFingerprint(representative, group.rootCauseId),
        metadata: {
          ...(representative.metadata || {}),
          rootCauseId: group.rootCauseId,
          rootCauseLabel: group.rootCauseLabel,
          affectedParameter: group.affectedParameter,
          instanceCount,
          affectedAssets,
          consolidation: {
            rawInstanceCount: instanceCount,
            severityEscalatedFrom: normalizeSeverity(representative.severity),
            severityEscalatedTo: severity
          }
        }
      };
    });

    return {
      consolidatedFindings,
      rawFindingCount: rawFindings.length,
      consolidatedFindingCount: consolidatedFindings.length,
      deduplicationRatio:
        consolidatedFindings.length > 0
          ? Number((rawFindings.length / consolidatedFindings.length).toFixed(2))
          : 0,
      consolidationAudit
    };
  }
}

module.exports = {
  FindingConsolidationEngine,
  findingConsolidationEngine: new FindingConsolidationEngine(),
  ROOT_CAUSES,
  classifyRootCause,
  buildFindingFingerprint,
  escalateSeverity
};
