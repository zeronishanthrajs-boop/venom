const CveSnapshot = require("../models/CveSnapshot");
const { callGeminiText } = require("./geminiClient");

const NVD_BASE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const TAG_CANDIDATES = [
  "web",
  "cms",
  "auth",
  "rce",
  "sqli",
  "xss",
  "ssrf",
  "idor",
  "lfi",
  "rfi",
  "deserialization",
  "cloud",
  "container",
  "api",
  "network",
  "windows",
  "linux",
  "privilege-escalation",
  "information-disclosure",
  "known-exploited",
  "critical"
];

function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIsoDateDaysAgo(daysAgo) {
  const now = Date.now();
  const delta = Math.max(toInteger(daysAgo, 7), 1);
  return new Date(now - delta * 24 * 60 * 60 * 1000).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function extractProductsFromCpes(cpes = []) {
  const products = [];

  for (const cpe of cpes) {
    const parts = String(cpe).split(":");
    if (parts.length < 6) {
      continue;
    }
    const vendor = parts[3];
    const product = parts[4];
    if (!vendor || !product || vendor === "*" || product === "*") {
      continue;
    }
    products.push(`${vendor}:${product}`);
  }

  return [...new Set(products)].slice(0, 30);
}

function inferTagsHeuristic({ description = "", cweIds = [], cpes = [] }) {
  const tags = new Set();
  const text = `${description} ${cweIds.join(" ")} ${cpes.join(" ")}`.toLowerCase();

  if (/xss|cross-site scripting/.test(text)) tags.add("xss");
  if (/sql injection|sqli/.test(text)) tags.add("sqli");
  if (/ssrf|server-side request forgery/.test(text)) tags.add("ssrf");
  if (/idor|insecure direct object reference/.test(text)) tags.add("idor");
  if (/local file inclusion|\blfi\b|path traversal|directory traversal/.test(text))
    tags.add("lfi");
  if (/remote file inclusion|\brfi\b/.test(text)) tags.add("rfi");
  if (/deserializ|object injection/.test(text)) tags.add("deserialization");
  if (/auth|authentication|login|credential|token/.test(text)) tags.add("auth");
  if (/privilege escalation|elevation of privilege/.test(text))
    tags.add("privilege-escalation");
  if (/information disclosure|sensitive|exposure|leak/.test(text))
    tags.add("information-disclosure");
  if (/remote code execution|\brce\b|command injection/.test(text)) tags.add("rce");
  if (/api|graphql|rest endpoint/.test(text)) tags.add("api");
  if (/wordpress|drupal|joomla|plugin|theme/.test(text)) tags.add("cms");
  if (/aws|azure|gcp|iam|bucket|cloud/.test(text)) tags.add("cloud");
  if (/kubernetes|docker|container|pod/.test(text)) tags.add("container");
  if (/windows/.test(text)) tags.add("windows");
  if (/linux|unix/.test(text)) tags.add("linux");
  if (/http|web server|nginx|apache|tomcat/.test(text)) tags.add("web");
  if (/network|tcp|udp|dns|tls|ssl/.test(text)) tags.add("network");

  return [...tags].filter((tag) => TAG_CANDIDATES.includes(tag)).slice(0, 8);
}

function parseTagArrayResponse(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => String(item || "").trim().toLowerCase())
      .filter((item) => TAG_CANDIDATES.includes(item));
  } catch {
    return [];
  }
}

async function tagCveForVenom({ cveId, description, cvssScore, cweIds, cpes }) {
  const heuristic = inferTagsHeuristic({
    description,
    cweIds,
    cpes
  });

  const apiKey = process.env.GEMINI_API_KEY;
  const enabled = process.env.ENABLE_GEMINI_CVE_TAGGING !== "false";
  if (!enabled || !apiKey || (typeof cvssScore === "number" && cvssScore < 4.0)) {
    return heuristic.length > 0 ? heuristic : ["information-disclosure"];
  }

  const model = process.env.GEMINI_TAGGER_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const timeoutMs = Math.max(toInteger(process.env.GEMINI_TAGGER_TIMEOUT_MS, 15000), 5000);

  const message = [
    `CVE: ${cveId}`,
    `CVSS: ${cvssScore ?? "unknown"}`,
    `Description: ${description}`,
    `CWE: ${cweIds.join(", ") || "none"}`,
    `CPE sample: ${cpes.slice(0, 8).join(", ") || "none"}`,
    "",
    `Return a JSON array of 1-5 tags from this allowlist only:`,
    `[${TAG_CANDIDATES.join(", ")}]`,
    "",
    "Output JSON only."
  ].join("\n");

  try {
    const response = await callGeminiText({
      apiKey,
      model,
      userPrompt: message,
      temperature: 0,
      maxOutputTokens: 256,
      timeoutMs,
      responseMimeType: "application/json"
    }).catch(() => null);

    if (!response) {
      return heuristic.length > 0 ? heuristic : ["information-disclosure"];
    }

    const parsedTags = parseTagArrayResponse(response.text || "");

    const merged = [...new Set([...heuristic, ...parsedTags])];
    return merged.length > 0 ? merged.slice(0, 8) : ["information-disclosure"];
  } catch {
    return heuristic.length > 0 ? heuristic : ["information-disclosure"];
  }
}

function computeRelevanceScore({ cvssScore, applicabilityTags, exploitAvailable }) {
  const score = Number.isFinite(cvssScore) ? cvssScore : 0;
  const priorityTags = new Set(["rce", "auth", "web", "cms", "sqli", "ssrf"]);
  const tagBoost = (applicabilityTags || []).reduce(
    (acc, tag) => acc + (priorityTags.has(tag) ? 8 : 2),
    0
  );
  const exploitBoost = exploitAvailable ? 15 : 0;
  const base = score * 6;
  return Math.min(100, Math.round(base + tagBoost + exploitBoost));
}

function normalizeCveRecord(vulnerability) {
  const cve = vulnerability?.cve || {};
  const cvss = pickCvssMetric(cve.metrics || {});
  const baseTags = [];
  const cweIds = extractCweIds(cve.weaknesses || []);
  const cpes = extractCpes(cve.configurations || []);
  const exploitAvailable = Boolean(cve.cisaExploitAdd);

  if (exploitAvailable) {
    baseTags.push("known-exploited");
  }
  if (cvss.severity === "CRITICAL") {
    baseTags.push("critical");
  }

  const description = extractEnglishDescription(cve.descriptions || []);
  const affectedProducts = extractProductsFromCpes(cpes);

  return {
    cveId: cve.id || "",
    publishedAt: cve.published ? new Date(cve.published) : null,
    lastModifiedAt: cve.lastModified ? new Date(cve.lastModified) : null,
    sourceIdentifier: cve.sourceIdentifier || "",
    status: cve.vulnStatus || "",
    description,
    cvssScore: cvss.score,
    cvssSeverity: cvss.severity,
    severity: cvss.severity,
    cvssVector: cvss.vector,
    affectedProducts,
    exploitAvailable,
    cweIds,
    references: extractReferences(cve.references || []),
    cpes,
    tags: baseTags,
    applicabilityTags: [],
    venomRelevanceScore: 0,
    ingestedAt: new Date(),
    raw: {
      version: cvss.version,
      cisaExploitAdd: cve.cisaExploitAdd || null,
      cisaActionDue: cve.cisaActionDue || null
    }
  };
}

async function fetchNvdVulnerabilities(options = {}) {
  const baseUrl = process.env.NVD_API_URL || NVD_BASE_URL;
  const timeoutMs = Math.max(toInteger(process.env.NVD_REQUEST_TIMEOUT_MS, 15000), 5000);
  const requestedLimit = Math.min(
    Math.max(
      toInteger(options.limit, toInteger(process.env.NVD_SYNC_LIMIT, 25)),
      1
    ),
    200
  );
  const pageSize = Math.min(
    Math.max(toInteger(process.env.NVD_PAGE_SIZE, 100), 1),
    requestedLimit
  );

  const headers = {
    accept: "application/json"
  };
  if (process.env.NVD_API_KEY) {
    headers.apiKey = process.env.NVD_API_KEY;
  }

  const vulnerabilities = [];
  let startIndex = Math.max(toInteger(options.startIndex, 0), 0);
  let totalResults = Number.POSITIVE_INFINITY;

  while (vulnerabilities.length < requestedLimit && startIndex < totalResults) {
    const query = buildCveQuery({
      ...options,
      limit: Math.min(pageSize, requestedLimit - vulnerabilities.length),
      startIndex
    });
    const url = `${baseUrl}?${query.toString()}`;

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
    const batch = Array.isArray(payload?.vulnerabilities) ? payload.vulnerabilities : [];
    totalResults = Number(payload?.totalResults || batch.length);
    vulnerabilities.push(...batch);

    if (batch.length === 0) {
      break;
    }

    startIndex += batch.length;
    if (!process.env.NVD_API_KEY && vulnerabilities.length < requestedLimit) {
      await sleep(Math.max(toInteger(process.env.NVD_NO_KEY_DELAY_MS, 6000), 1000));
    }
  }

  return vulnerabilities.slice(0, requestedLimit);
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

async function enrichRecordsWithTags(records) {
  const enriched = [];

  for (const record of records) {
    const tags = await tagCveForVenom({
      cveId: record.cveId,
      description: record.description,
      cvssScore: record.cvssScore,
      cweIds: record.cweIds,
      cpes: record.cpes
    });
    const mergedTags = [...new Set([...(record.tags || []), ...tags])];
    const relevance = computeRelevanceScore({
      cvssScore: record.cvssScore,
      applicabilityTags: mergedTags,
      exploitAvailable: record.exploitAvailable
    });

    enriched.push({
      ...record,
      tags: mergedTags,
      applicabilityTags: mergedTags,
      venomRelevanceScore: relevance
    });
  }

  return enriched;
}

async function syncRecentCves(options = {}) {
  const vulnerabilities = await fetchNvdVulnerabilities(options);
  const normalized = vulnerabilities.map((item) => normalizeCveRecord(item));
  const enriched = await enrichRecordsWithTags(normalized);

  const dedupedMap = new Map();
  for (const record of enriched) {
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
  inferTagsHeuristic,
  computeRelevanceScore,
  fetchNvdVulnerabilities,
  upsertNormalizedCves,
  syncRecentCves
};
