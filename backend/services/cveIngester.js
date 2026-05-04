const CveSnapshot = require("../models/CveSnapshot");

const NVD_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";

function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoDateDaysAgo(daysAgo) {
  const now = Date.now();
  const delta = Math.max(toInteger(daysAgo, 7), 1);
  return new Date(now - delta * 24 * 60 * 60 * 1000).toISOString();
}

function buildCveQuery(options = {}) {
  const limit = Math.min(
    Math.max(
      toInteger(options.limit, toInteger(process.env.NVD_SYNC_LIMIT, 25)),
      1
    ),
    200
  );
  const sinceDays = Math.max(
    toInteger(options.sinceDays, toInteger(process.env.NVD_SYNC_DAYS, 7)),
    1
  );

  const params = new URLSearchParams({
    resultsPerPage: String(limit)
  });
  const pubStartDate = toIsoDateDaysAgo(sinceDays);
  const pubEndDate = new Date().toISOString();
  params.set("pubStartDate", pubStartDate);
  params.set("pubEndDate", pubEndDate);

  if (options.keywordSearch) {
    params.set("keywordSearch", String(options.keywordSearch));
  }
  if (options.severity) {
    params.set("cvssV3Severity", String(options.severity).toUpperCase());
  }
  if (options.startIndex !== undefined) {
    params.set("startIndex", String(Math.max(toInteger(options.startIndex, 0), 0)));
  }

  return params;
}

function pickCvssMetric(metrics = {}) {
  const candidates = [
    ...(Array.isArray(metrics.cvssMetricV40) ? metrics.cvssMetricV40 : []),
    ...(Array.isArray(metrics.cvssMetricV31) ? metrics.cvssMetricV31 : []),
    ...(Array.isArray(metrics.cvssMetricV30) ? metrics.cvssMetricV30 : []),
    ...(Array.isArray(metrics.cvssMetricV2) ? metrics.cvssMetricV2 : [])
  ];

  for (const metric of candidates) {
    const cvssData = metric?.cvssData;
    if (!cvssData || typeof cvssData.baseScore !== "number") {
      continue;
    }

    return {
      score: cvssData.baseScore,
      severity: String(cvssData.baseSeverity || metric.baseSeverity || "").toUpperCase(),
      vector: cvssData.vectorString || "",
      version: cvssData.version || ""
    };
  }

  return {
    score: null,
    severity: "",
    vector: "",
    version: ""
  };
}

function extractEnglishDescription(descriptions = []) {
  const english = descriptions.find(
    (item) => item && item.lang === "en" && typeof item.value === "string"
  );
  return english?.value || "";
}

function extractCweIds(weaknesses = []) {
  const values = [];

  for (const weakness of weaknesses) {
    const descriptions = Array.isArray(weakness?.description)
      ? weakness.description
      : [];
    for (const item of descriptions) {
      if (typeof item?.value !== "string") {
        continue;
      }
      const matches = item.value.match(/CWE-\d+/gi) || [];
      values.push(...matches.map((value) => value.toUpperCase()));
    }
  }

  return [...new Set(values)];
}

function extractReferences(refs = []) {
  return refs
    .map((item) => item?.url)
    .filter((value) => typeof value === "string" && value.trim())
    .slice(0, 50);
}

function flattenConfigurations(nodes = []) {
  const cpes = [];

  for (const node of nodes) {
    const matches = Array.isArray(node?.cpeMatch) ? node.cpeMatch : [];
    for (const cpe of matches) {
      if (typeof cpe?.criteria === "string" && cpe.criteria.trim()) {
        cpes.push(cpe.criteria);
      }
    }
    if (Array.isArray(node?.children) && node.children.length > 0) {
      cpes.push(...flattenConfigurations(node.children));
    }
  }

  return cpes;
}

function extractCpes(configurations = []) {
  const allNodes = configurations
    .map((item) => item?.nodes)
    .filter((item) => Array.isArray(item))
    .flat();
  return [...new Set(flattenConfigurations(allNodes))].slice(0, 100);
}

function normalizeCveRecord(vulnerability) {
  const cve = vulnerability?.cve || {};
  const cvss = pickCvssMetric(cve.metrics || {});
  const tags = [];

  if (cve.cisaExploitAdd) {
    tags.push("known-exploited");
  }
  if (cvss.severity === "CRITICAL") {
    tags.push("critical");
  }

  return {
    cveId: cve.id || "",
    publishedAt: cve.published ? new Date(cve.published) : null,
    lastModifiedAt: cve.lastModified ? new Date(cve.lastModified) : null,
    sourceIdentifier: cve.sourceIdentifier || "",
    status: cve.vulnStatus || "",
    description: extractEnglishDescription(cve.descriptions || []),
    cvssScore: cvss.score,
    cvssSeverity: cvss.severity,
    cvssVector: cvss.vector,
    cweIds: extractCweIds(cve.weaknesses || []),
    references: extractReferences(cve.references || []),
    cpes: extractCpes(cve.configurations || []),
    tags,
    raw: {
      version: cvss.version,
      cisaExploitAdd: cve.cisaExploitAdd || null,
      cisaActionDue: cve.cisaActionDue || null
    }
  };
}

async function fetchNvdVulnerabilities(options = {}) {
  const baseUrl = process.env.NVD_API_URL || NVD_BASE_URL;
  const query = buildCveQuery(options);
  const url = `${baseUrl}?${query.toString()}`;
  const timeoutMs = Math.max(toInteger(process.env.NVD_REQUEST_TIMEOUT_MS, 15000), 5000);

  const headers = {
    accept: "application/json"
  };
  if (process.env.NVD_API_KEY) {
    headers.apiKey = process.env.NVD_API_KEY;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal:
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(timeoutMs)
        : undefined
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`NVD request failed (${response.status}): ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.vulnerabilities) ? payload.vulnerabilities : [];
}

async function upsertNormalizedCves(records) {
  const operations = records
    .filter((item) => item.cveId)
    .map((item) => ({
      updateOne: {
        filter: { cveId: item.cveId },
        update: { $set: item },
        upsert: true
      }
    }));

  if (operations.length === 0) {
    return {
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0
    };
  }

  const result = await CveSnapshot.bulkWrite(operations, { ordered: false });
  return {
    matchedCount: result.matchedCount || 0,
    modifiedCount: result.modifiedCount || 0,
    upsertedCount: result.upsertedCount || 0
  };
}

async function syncRecentCves(options = {}) {
  const vulnerabilities = await fetchNvdVulnerabilities(options);
  const normalized = vulnerabilities.map((item) => normalizeCveRecord(item));

  const dedupedMap = new Map();
  for (const record of normalized) {
    if (record.cveId) {
      dedupedMap.set(record.cveId, record);
    }
  }
  const deduped = [...dedupedMap.values()];

  const writeResult = await upsertNormalizedCves(deduped);
  return {
    fetched: vulnerabilities.length,
    normalized: deduped.length,
    ...writeResult
  };
}

module.exports = {
  buildCveQuery,
  pickCvssMetric,
  normalizeCveRecord,
  fetchNvdVulnerabilities,
  upsertNormalizedCves,
  syncRecentCves
};
