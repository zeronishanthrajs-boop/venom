const axios = require("axios");
const { logger } = require("../config/logger");

const Pattern = require("../models/Pattern");
const ResearchLog = require("../models/ResearchLog");
const { evolvePrompts } = require("./promptEvolver");
const { broadcastResearchUpdate } = require("./realtimeServer");
const { callGeminiText } = require("./geminiClient");

const RESEARCH_SOURCES = [
  {
    name: "CISA_KEV",
    url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    type: "cisa",
    priority: 1
  },
  {
    name: "NVD_RECENT",
    url: "https://services.nvd.nist.gov/rest/json/cves/2.0",
    type: "nvd",
    priority: 2
  },
  {
    name: "GITHUB_ADVISORIES",
    url: "https://api.github.com/advisories?type=reviewed&per_page=10",
    type: "github",
    priority: 3
  }
];

const TARGET_TYPE_MAP = {
  web: "website",
  website: "website",
  api: "api",
  network: "network",
  cloud: "network"
};

let nextNvdRequestAtMs = 0;

function sleep(ms) {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getNvdApiKey() {
  return String(process.env.NVD_API_KEY || "").trim();
}

function getNvdNoKeyDelayMs() {
  return Math.max(toInteger(process.env.NVD_NO_KEY_DELAY_MS, 6000), 1000);
}

function getNvdMaxAttempts() {
  return Math.max(toInteger(process.env.NVD_MAX_ATTEMPTS, 4), 1);
}

function parseRetryAfterMs(value) {
  if (value === undefined || value === null) {
    return 0;
  }
  const asNumber = Number.parseInt(String(value).trim(), 10);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber * 1000;
  }
  const asDateMs = Date.parse(String(value));
  if (Number.isFinite(asDateMs) && asDateMs > Date.now()) {
    return asDateMs - Date.now();
  }
  return 0;
}

function shouldRetryNvdStatus(statusCode) {
  return [403, 429, 500, 502, 503, 504].includes(Number(statusCode || 0));
}

function getNvdMinRequestGapMs(hasApiKey) {
  if (hasApiKey) {
    return Math.max(toInteger(process.env.NVD_KEYED_DELAY_MS, 700), 200);
  }
  return getNvdNoKeyDelayMs();
}

async function throttleNvdRequests(hasApiKey) {
  const minGapMs = getNvdMinRequestGapMs(hasApiKey);
  const nowMs = Date.now();
  const scheduledAtMs = Math.max(nowMs, nextNvdRequestAtMs);
  nextNvdRequestAtMs = scheduledAtMs + minGapMs;
  const waitMs = scheduledAtMs - nowMs;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function computeNvdBackoffMs({ attempt, retryAfterMs, hasApiKey }) {
  const attemptNumber = Math.max(Number(attempt || 1), 1);
  const baseDelayMs = hasApiKey
    ? Math.max(toInteger(process.env.NVD_BACKOFF_BASE_KEYED_MS, 750), 250)
    : getNvdNoKeyDelayMs();
  const exponentialDelayMs = Math.min(
    baseDelayMs * 2 ** (attemptNumber - 1),
    Math.max(toInteger(process.env.NVD_MAX_BACKOFF_MS, 60000), baseDelayMs)
  );
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(retryAfterMs, exponentialDelayMs);
  }
  return exponentialDelayMs;
}

function getNvdRequestHeaders(baseHeaders = {}) {
  const apiKey = getNvdApiKey();
  return apiKey
    ? {
        ...baseHeaders,
        apiKey
      }
    : { ...baseHeaders };
}

function normalizeText(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function toPatternTargetType(value) {
  const normalized = String(value || "website").toLowerCase().trim();
  return TARGET_TYPE_MAP[normalized] || "website";
}

function inferTargetType(tags = []) {
  const set = new Set((tags || []).map((item) => String(item || "").toLowerCase()));
  if (set.has("network") || set.has("cloud") || set.has("container")) {
    return "network";
  }
  if (set.has("api")) {
    return "api";
  }
  return "website";
}

function buildAssessmentSequence(tags = []) {
  const set = new Set((tags || []).map((item) => String(item || "").toLowerCase()));
  const sequence = ["http_headers_probe", "dns_lookup_probe", "tls_metadata_probe"];
  if (set.has("network") || set.has("cloud") || set.has("container")) {
    sequence.push("nmap_tcp_scan");
  }
  if (set.has("web") || set.has("cms") || set.has("api") || set.has("known-exploited")) {
    sequence.push("nuclei_scan");
  }
  if (set.has("web") || set.has("cms")) {
    sequence.push("nikto_scan");
  }
  if (set.has("sqli") || set.has("api")) {
    sequence.push("sqlmap_detect");
  }
  const deduped = [];
  const seen = new Set();
  for (const item of sequence) {
    if (!seen.has(item)) {
      deduped.push(item);
      seen.add(item);
    }
  }
  return deduped;
}

function mapCisaKevToPatternCandidate(item) {
  const cveId = String(item?.cveID || item?.cveId || "").trim();
  if (!cveId) {
    return null;
  }
  const text = normalizeText(
    `${item?.vendorProject || ""} ${item?.product || ""} ${item?.shortDescription || ""}`,
    600
  ).toLowerCase();
  const tags = ["known-exploited", "threat-intel"];
  if (/api|graphql|rest/.test(text)) tags.push("api");
  if (/network|router|firewall|vpn|switch/.test(text)) tags.push("network");
  if (/wordpress|drupal|cms|plugin/.test(text)) tags.push("cms", "web");
  if (/auth|login|token|credential/.test(text)) tags.push("auth");
  if (/sql|injection/.test(text)) tags.push("sqli");

  return {
    name: `CISA KEV Focus: ${cveId}`,
    description: normalizeText(item?.shortDescription || `${cveId} listed in CISA KEV.`),
    targetType: inferTargetType(tags),
    tags: [...new Set(tags)],
    assessmentSequence: buildAssessmentSequence(tags),
    successRate: 0.72,
    confidence: 0.75,
    generalizationScore: 0.68,
    prerequisites: [`cve:${cveId}`, "known-exploited"],
    source: "research-CISA_KEV"
  };
}

function mapGithubAdvisoryToPatternCandidate(item) {
  const ghsaId = String(item?.ghsa_id || item?.ghsaId || "").trim();
  if (!ghsaId) {
    return null;
  }
  const severity = String(item?.severity || "medium").toLowerCase();
  const summary = normalizeText(item?.summary || item?.description || ghsaId, 420);
  const text = `${summary} ${String(item?.description || "")}`.toLowerCase();
  const tags = ["github-advisory", "threat-intel"];
  if (/api|graphql|rest/.test(text)) tags.push("api");
  if (/sql|injection/.test(text)) tags.push("sqli");
  if (/auth|token|credential|oauth/.test(text)) tags.push("auth");
  if (/xss|cross-site/.test(text)) tags.push("xss");
  if (/ssrf/.test(text)) tags.push("ssrf");
  if (/rce|remote code execution/.test(text)) tags.push("rce");
  if (/network|tcp|udp|dns|tls/.test(text)) tags.push("network");

  const baseConfidence =
    severity === "critical" ? 0.86 : severity === "high" ? 0.77 : 0.65;

  return {
    name: `GHSA Focus: ${ghsaId}`,
    description: summary,
    targetType: inferTargetType(tags),
    tags: [...new Set(tags)],
    assessmentSequence: buildAssessmentSequence(tags),
    successRate: Math.max(0.55, baseConfidence - 0.04),
    confidence: baseConfidence,
    generalizationScore: 0.62,
    prerequisites: [`ghsa:${ghsaId}`, `severity:${severity}`],
    source: "research-GITHUB_ADVISORIES"
  };
}

function mapNvdToPatternCandidate(entry) {
  const cve = entry?.cve || {};
  const cveId = String(cve?.id || "").trim();
  if (!cveId) {
    return null;
  }
  const description = Array.isArray(cve?.descriptions)
    ? cve.descriptions.find((item) => item?.lang === "en")?.value || ""
    : "";
  const cvss = cve?.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore;
  const tags = ["known-cve", "threat-intel"];
  const text = `${description}`.toLowerCase();
  if (/api|graphql|rest/.test(text)) tags.push("api");
  if (/network|dns|tcp|udp/.test(text)) tags.push("network");
  if (/wordpress|drupal|plugin|theme|cms/.test(text)) tags.push("cms", "web");
  if (/sql|injection/.test(text)) tags.push("sqli");
  if (/auth|session|token/.test(text)) tags.push("auth");

  const score = Number.isFinite(cvss) ? cvss : 5;
  const confidence = Math.max(0.45, Math.min(0.92, score / 10));
  return {
    name: `NVD Focus: ${cveId}`,
    description: normalizeText(description || `${cveId} observed in NVD feed.`),
    targetType: inferTargetType(tags),
    tags: [...new Set(tags)],
    assessmentSequence: buildAssessmentSequence(tags),
    successRate: Math.max(0.55, confidence),
    confidence,
    generalizationScore: Math.max(0.6, Math.min(0.95, confidence + 0.08)),
    prerequisites: [`cve:${cveId}`],
    source: "research-NVD_RECENT"
  };
}

async function fetchNvdFeed(source, baseConfig) {
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const today = new Date().toISOString();
  const maxAttempts = getNvdMaxAttempts();
  const hasApiKey = Boolean(getNvdApiKey());

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await throttleNvdRequests(hasApiKey);
      const response = await axios.get(source.url, {
        ...baseConfig,
        headers: getNvdRequestHeaders(baseConfig.headers),
        params: {
          pubStartDate: yesterday,
          pubEndDate: today,
          resultsPerPage: 20
        }
      });
      return Array.isArray(response.data?.vulnerabilities)
        ? response.data.vulnerabilities.slice(0, 10)
        : [];
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);
      if (attempt >= maxAttempts || !shouldRetryNvdStatus(statusCode)) {
        throw error;
      }
      const retryAfterMs = parseRetryAfterMs(error?.response?.headers?.["retry-after"]);
      const backoffMs = computeNvdBackoffMs({
        attempt,
        retryAfterMs,
        hasApiKey
      });
      logger.warn(
        {
          source: source.name,
          statusCode,
          attempt,
          maxAttempts,
          backoffMs
        },
        "NVD request failed, retrying with backoff"
      );
      // eslint-disable-next-line no-await-in-loop
      await sleep(backoffMs);
    }
  }

  return [];
}

async function safeFetch(source) {
  try {
    const baseConfig = {
      timeout: 20000,
      headers: { "User-Agent": "VENOM-ResearchEngine/3.0" }
    };

    if (source.type === "nvd") {
      return await fetchNvdFeed(source, baseConfig);
    }

    if (source.type === "cisa") {
      const response = await axios.get(source.url, baseConfig);
      const vulnerabilities = Array.isArray(response.data?.vulnerabilities)
        ? response.data.vulnerabilities
        : [];
      return vulnerabilities.slice(-15);
    }

    if (source.type === "github") {
      const response = await axios.get(source.url, {
        ...baseConfig,
        headers: {
          ...baseConfig.headers,
          Accept: "application/vnd.github+json"
        }
      });
      return Array.isArray(response.data) ? response.data.slice(0, 10) : [];
    }

    return null;
  } catch (err) {
    logger.warn(
      { source: source.name, error: err.message },
      "Research source fetch failed"
    );
    return null;
  }
}

function parseGeminiJson(text) {
  const cleaned = String(text || "").replace(/```json|```/gi, "").trim();
  if (!cleaned) {
    return null;
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function buildHeuristicTechniques(sourceName, rawData) {
  if (!Array.isArray(rawData) || rawData.length === 0) {
    return [];
  }

  if (sourceName === "CISA_KEV") {
    return rawData.map(mapCisaKevToPatternCandidate).filter(Boolean);
  }

  if (sourceName === "GITHUB_ADVISORIES") {
    return rawData.map(mapGithubAdvisoryToPatternCandidate).filter(Boolean);
  }

  if (sourceName === "NVD_RECENT") {
    return rawData.map(mapNvdToPatternCandidate).filter(Boolean);
  }

  return [];
}

async function safeGeminiAnalyze(sourceName, rawData) {
  if (!process.env.GEMINI_API_KEY) {
    return {
      techniques: buildHeuristicTechniques(sourceName, rawData),
      researchSummary: "No Gemini API key configured. Heuristic extraction used."
    };
  }

  try {
    const dataStr = JSON.stringify(rawData).slice(0, 6000);
    const response = await callGeminiText({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_RESEARCH_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash",
      maxOutputTokens: 1500,
      temperature: 0.2,
      responseMimeType: "application/json",
      userPrompt: `Analyze this security feed from ${sourceName} and extract NEW actionable attack techniques for web/API/network penetration testing.

DATA:
${dataStr}

Return JSON:
{
  "techniques": [
    {
      "name": string,
      "description": string,
      "targetType": "web"|"api"|"network"|"cloud",
      "tags": string[],
      "exploitSequence": string[],
      "prerequisites": string[],
      "estimatedSuccessRate": number,
      "generalizationScore": number,
      "sourceReference": string
    }
  ],
  "researchSummary": string
}`
    });

    const text = response.text || "";
    const parsed = parseGeminiJson(text);
    if (!parsed || !Array.isArray(parsed.techniques)) {
      return {
        techniques: buildHeuristicTechniques(sourceName, rawData),
        researchSummary: "Gemini output parsing failed. Heuristic extraction used."
      };
    }
    return parsed;
  } catch (err) {
    logger.warn(
      { source: sourceName, error: err.message },
      "Research Gemini analysis failed"
    );
    return {
      techniques: buildHeuristicTechniques(sourceName, rawData),
      researchSummary: `Analysis failed: ${err.message}`
    };
  }
}

function normalizeTechnique(technique = {}, fallbackSource = "research-manual") {
  const tags = Array.isArray(technique.tags)
    ? technique.tags.map((item) => String(item).toLowerCase().trim()).filter(Boolean)
    : [];
  const uniqueTags = [...new Set(tags)];
  const inferredType = toPatternTargetType(technique.targetType || inferTargetType(uniqueTags));
  const confidence = Number.isFinite(Number(technique.estimatedSuccessRate))
    ? Math.max(0.2, Math.min(0.95, Number(technique.estimatedSuccessRate)))
    : 0.55;
  const generalizationScore = Number.isFinite(Number(technique.generalizationScore))
    ? Math.max(0, Math.min(1, Number(technique.generalizationScore)))
    : 0.6;

  return {
    name: normalizeText(technique.name || "Untitled research technique", 140),
    description: normalizeText(technique.description || "Research-derived pattern."),
    targetType: inferredType,
    tags: uniqueTags.slice(0, 12),
    assessmentSequence: buildAssessmentSequence(uniqueTags),
    prerequisites: Array.isArray(technique.prerequisites)
      ? technique.prerequisites.map((item) => String(item)).slice(0, 12)
      : [],
    successRate: confidence,
    confidence: Number((confidence * Math.max(generalizationScore, 0.5)).toFixed(4)),
    generalizationScore,
    source: normalizeText(
      technique.sourceReference ? `research-${technique.sourceReference}` : fallbackSource,
      120
    )
  };
}

async function upsertTechnique(candidate) {
  const existing = await Pattern.findOne({
    name: { $regex: new RegExp(`^${candidate.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }
  }).lean();

  if (existing) {
    await Pattern.updateOne(
      { _id: existing._id },
      {
        $set: {
          description: candidate.description,
          targetType: candidate.targetType,
          tags: candidate.tags,
          assessmentSequence: candidate.assessmentSequence,
          prerequisites: candidate.prerequisites,
          successRate: candidate.successRate,
          confidence: candidate.confidence,
          generalizationScore: candidate.generalizationScore,
          source: candidate.source
        }
      }
    );
    return "updated";
  }

  await Pattern.create({
    name: candidate.name,
    description: candidate.description,
    targetType: candidate.targetType,
    tags: candidate.tags,
    assessmentSequence: candidate.assessmentSequence,
    prerequisites: candidate.prerequisites,
    successRate: candidate.successRate,
    confidence: candidate.confidence,
    recentOutcomes: [],
    recentSuccessRate: candidate.successRate,
    generalizationScore: candidate.generalizationScore,
    successCount: 0,
    failureCount: 0,
    source: candidate.source
  });
  return "created";
}

async function runResearchCycle({
  trigger = "manual",
  createdBy = "system",
  sourceFilter = []
} = {}) {
  const startedAt = new Date();
  const report = {
    runAt: startedAt,
    trigger,
    createdBy,
    sourcesChecked: 0,
    sourcesSucceeded: 0,
    newTechniquesFound: 0,
    newPatternsCreated: 0,
    patternsUpdated: 0,
    errors: [],
    sourceResults: [],
    promptEvolutionTriggered: false
  };

  const filterSet =
    Array.isArray(sourceFilter) && sourceFilter.length > 0
      ? new Set(sourceFilter.map((item) => String(item).toLowerCase()))
      : null;

  const sources = RESEARCH_SOURCES.filter((source) => {
    if (!filterSet) {
      return true;
    }
    return (
      filterSet.has(String(source.type).toLowerCase()) ||
      filterSet.has(String(source.name).toLowerCase())
    );
  }).sort((a, b) => a.priority - b.priority);

  for (const source of sources) {
    report.sourcesChecked += 1;

    try {
      const rawData = await safeFetch(source);
      if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) {
        report.errors.push(`${source.name}: No data returned`);
        report.sourceResults.push({
          source: source.name,
          status: "error",
          fetchedCount: 0,
          generatedPatterns: 0,
          error: "No data returned"
        });
        continue;
      }

      const analysis = await safeGeminiAnalyze(source.name, rawData);
      report.sourcesSucceeded += 1;

      let sourceCreated = 0;
      let sourceUpdated = 0;
      const techniques = Array.isArray(analysis?.techniques) ? analysis.techniques : [];
      for (const technique of techniques) {
        try {
          const normalized = normalizeTechnique(technique, `research-${source.name}`);
          if (normalized.generalizationScore < 0.6 || !normalized.name) {
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          const status = await upsertTechnique(normalized);
          if (status === "created") {
            sourceCreated += 1;
            report.newTechniquesFound += 1;
            report.newPatternsCreated += 1;
          } else {
            sourceUpdated += 1;
            report.patternsUpdated += 1;
          }
        } catch (patternErr) {
          report.errors.push(`Pattern save failed: ${patternErr.message}`);
        }
      }

      report.sourceResults.push({
        source: source.name,
        status: "ok",
        fetchedCount: Array.isArray(rawData) ? rawData.length : 1,
        generatedPatterns: sourceCreated + sourceUpdated,
        summary:
          analysis?.researchSummary ||
          `Created ${sourceCreated}, updated ${sourceUpdated} candidate pattern(s).`
      });
    } catch (outerErr) {
      report.errors.push(`${source.name} OUTER ERROR: ${outerErr.message}`);
      report.sourceResults.push({
        source: source.name,
        status: "error",
        fetchedCount: 0,
        generatedPatterns: 0,
        error: outerErr.message
      });
    }
  }

  if (report.newTechniquesFound >= 3) {
    try {
      await evolvePrompts({
        promptTypes: ["planning", "chain", "learning"],
        createdBy: "research-cycle-auto"
      });
      report.promptEvolutionTriggered = true;
    } catch (evoErr) {
      report.errors.push(`Prompt evolution error: ${evoErr.message}`);
    }
  }

  const completedAt = new Date();
  const summary = `Research cycle completed: sources=${report.sourcesSucceeded}/${report.sourcesChecked}, newPatterns=${report.newTechniquesFound}, updatedPatterns=${report.patternsUpdated}, errors=${report.errors.length}.`;
  const record = await ResearchLog.create({
    trigger,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    sourcesChecked: report.sourcesChecked,
    newPatternsCreated: report.newTechniquesFound,
    promptEvolutionTriggered: report.promptEvolutionTriggered,
    summary,
    sourceResults: report.sourceResults,
    errors: report.errors,
    createdBy
  });

  try {
    broadcastResearchUpdate({
      summary,
      newPatternsCreated: report.newTechniquesFound,
      updatedPatterns: report.patternsUpdated,
      promptEvolutionTriggered: report.promptEvolutionTriggered,
      runId: String(record._id)
    });
  } catch {
    // no-op
  }

  return {
    runId: String(record._id),
    trigger,
    sourcesChecked: report.sourcesChecked,
    sourcesSucceeded: report.sourcesSucceeded,
    newTechniquesFound: report.newTechniquesFound,
    newPatternsCreated: report.newTechniquesFound,
    updatedPatterns: report.patternsUpdated,
    promptEvolutionTriggered: report.promptEvolutionTriggered,
    summary,
    sourceResults: report.sourceResults,
    errors: report.errors
  };
}

async function getLatestResearchLog() {
  return ResearchLog.findOne({}).sort({ createdAt: -1 }).lean();
}

async function listResearchLogs(limit = 20) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return ResearchLog.find({}).sort({ createdAt: -1 }).limit(boundedLimit).lean();
}

module.exports = {
  runResearchCycle,
  getLatestResearchLog,
  listResearchLogs,
  __internal: {
    inferTargetType,
    buildAssessmentSequence,
    mapCisaKevToPatternCandidate,
    mapGithubAdvisoryToPatternCandidate,
    mapNvdToPatternCandidate,
    parseRetryAfterMs,
    shouldRetryNvdStatus,
    computeNvdBackoffMs,
    getNvdRequestHeaders,
    fetchNvdFeed,
    safeFetch
  }
};
