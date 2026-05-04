const CveSnapshot = require("../models/CveSnapshot");
const Pattern = require("../models/Pattern");
const ResearchLog = require("../models/ResearchLog");
const { evolvePrompts } = require("./promptEvolver");
const { broadcastResearchUpdate } = require("./realtimeServer");

const RESEARCH_SOURCES = [
  {
    name: "NVD Recent CVEs",
    type: "nvd",
    url: "https://services.nvd.nist.gov/rest/json/cves/2.0"
  },
  {
    name: "CISA Known Exploited Vulnerabilities",
    type: "cisa",
    url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
  },
  {
    name: "GitHub Security Advisories",
    type: "github",
    url: "https://api.github.com/advisories?type=reviewed&per_page=25"
  }
];

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

function inferTargetType(tags = []) {
  const set = new Set((tags || []).map((item) => String(item || "").toLowerCase()));
  if (set.has("network")) {
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
  if (
    set.has("web") ||
    set.has("cms") ||
    set.has("api") ||
    set.has("known-exploited")
  ) {
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

function mapCveToPatternCandidate(cve) {
  const tags = Array.isArray(cve.applicabilityTags)
    ? cve.applicabilityTags
    : Array.isArray(cve.tags)
    ? cve.tags
    : [];
  const targetType = inferTargetType(tags);
  const severity = String(cve.severity || cve.cvssSeverity || "MEDIUM").toUpperCase();
  const score = Number.isFinite(cve.cvssScore) ? cve.cvssScore : 0;
  const confidence = Math.min(0.95, Math.max(0.45, score / 10));

  return {
    key: `threat-intel-cve-${String(cve.cveId || "").toLowerCase()}`,
    name: `Threat Intel Focus: ${cve.cveId}`,
    description: normalizeText(
      cve.description || "CVE-derived security validation pattern."
    ),
    targetType,
    tags: [...new Set(["threat-intel", ...tags])].slice(0, 10),
    successRate: Math.max(0.55, confidence),
    confidence,
    generalizationScore: Math.max(0.6, Math.min(0.95, confidence + 0.1)),
    prerequisites: [
      `severity:${severity}`,
      `cve:${cve.cveId}`
    ],
    assessmentSequence: buildAssessmentSequence(tags),
    source: "research-intel"
  };
}

function mapCisaKevToPatternCandidate(item) {
  const cveId = String(item?.cveID || "").trim();
  if (!cveId) {
    return null;
  }
  const text = `${item?.vendorProject || ""} ${item?.product || ""} ${item?.shortDescription || ""}`.toLowerCase();
  const tags = ["known-exploited"];
  if (/api|graphql|rest/.test(text)) tags.push("api");
  if (/network|router|firewall|vpn|switch/.test(text)) tags.push("network");
  if (/wordpress|drupal|cms|plugin/.test(text)) tags.push("cms", "web");
  if (/auth|login|token|credential/.test(text)) tags.push("auth");

  return {
    key: `threat-intel-cisa-${cveId.toLowerCase()}`,
    name: `CISA KEV Focus: ${cveId}`,
    description: normalizeText(
      item?.shortDescription || `${cveId} listed in CISA KEV catalog.`
    ),
    targetType: inferTargetType(tags),
    tags: [...new Set(["threat-intel", ...tags])],
    successRate: 0.72,
    confidence: 0.8,
    generalizationScore: 0.68,
    prerequisites: [`cve:${cveId}`, "known-exploited"],
    assessmentSequence: buildAssessmentSequence(tags),
    source: "research-cisa"
  };
}

function mapGithubAdvisoryToPatternCandidate(item) {
  const ghsaId = String(item?.ghsa_id || "").trim();
  if (!ghsaId) {
    return null;
  }
  const severity = String(item?.severity || "medium").toLowerCase();
  const summary = item?.summary || item?.description || ghsaId;
  const text = `${summary} ${item?.description || ""}`.toLowerCase();
  const tags = ["github-advisory"];
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
    key: `threat-intel-ghsa-${ghsaId.toLowerCase()}`,
    name: `GHSA Focus: ${ghsaId}`,
    description: normalizeText(summary),
    targetType: inferTargetType(tags),
    tags: [...new Set(["threat-intel", ...tags])],
    successRate: Math.max(0.55, baseConfidence - 0.04),
    confidence: baseConfidence,
    generalizationScore: 0.62,
    prerequisites: [`ghsa:${ghsaId}`, `severity:${severity}`],
    assessmentSequence: buildAssessmentSequence(tags),
    source: "research-github"
  };
}

async function fetchJson(url, timeoutMs = 15000, headers = {}) {
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
    throw new Error(`Fetch failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

async function pullNvdCandidates() {
  const days = Math.max(toInteger(process.env.RESEARCH_NVD_DAYS, 2), 1);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const limit = Math.min(Math.max(toInteger(process.env.RESEARCH_NVD_LIMIT, 40), 5), 100);

  const params = new URLSearchParams({
    pubStartDate: since,
    pubEndDate: new Date().toISOString(),
    resultsPerPage: String(limit)
  });
  const url = `${RESEARCH_SOURCES[0].url}?${params.toString()}`;
  const payload = await fetchJson(url, 20000);

  const vulnerabilities = Array.isArray(payload?.vulnerabilities)
    ? payload.vulnerabilities
    : [];

  const mapped = vulnerabilities
    .map((entry) => {
      const cve = entry?.cve || {};
      const description = Array.isArray(cve.descriptions)
        ? cve.descriptions.find((item) => item?.lang === "en")?.value || ""
        : "";
      const cvss = cve.metrics?.cvssMetricV31?.[0]?.cvssData;
      return {
        cveId: cve.id,
        description,
        cvssScore: cvss?.baseScore || null,
        severity: cvss?.baseSeverity || "MEDIUM",
        applicabilityTags: []
      };
    })
    .filter((item) => item.cveId);

  return mapped.map(mapCveToPatternCandidate);
}

async function pullCisaCandidates() {
  const payload = await fetchJson(RESEARCH_SOURCES[1].url, 20000);
  const vulnerabilities = Array.isArray(payload?.vulnerabilities)
    ? payload.vulnerabilities.slice(0, 30)
    : [];

  return vulnerabilities
    .map((item) => mapCisaKevToPatternCandidate(item))
    .filter(Boolean);
}

async function pullGithubCandidates() {
  const headers = {
    Accept: "application/vnd.github+json"
  };
  const payload = await fetchJson(RESEARCH_SOURCES[2].url, 20000, headers);
  const advisories = Array.isArray(payload) ? payload : [];
  return advisories
    .map((item) => mapGithubAdvisoryToPatternCandidate(item))
    .filter(Boolean);
}

async function getSourceCandidates(source) {
  if (source.type === "nvd") {
    return pullNvdCandidates();
  }
  if (source.type === "cisa") {
    return pullCisaCandidates();
  }
  if (source.type === "github") {
    return pullGithubCandidates();
  }
  return [];
}

async function savePatternCandidates(candidates) {
  let created = 0;
  let updated = 0;
  for (const candidate of candidates) {
    const existing = await Pattern.findOne({ name: candidate.name }).lean();
    if (existing) {
      await Pattern.updateOne(
        { _id: existing._id },
        {
          $set: {
            description: candidate.description,
            targetType: candidate.targetType,
            tags: candidate.tags,
            prerequisites: candidate.prerequisites,
            assessmentSequence: candidate.assessmentSequence,
            source: candidate.source,
            successRate: candidate.successRate,
            confidence: candidate.confidence,
            generalizationScore: candidate.generalizationScore
          }
        }
      );
      updated += 1;
    } else {
      await Pattern.create({
        name: candidate.name,
        description: candidate.description,
        targetType: candidate.targetType,
        tags: candidate.tags,
        prerequisites: candidate.prerequisites,
        assessmentSequence: candidate.assessmentSequence,
        source: candidate.source,
        successRate: candidate.successRate,
        confidence: candidate.confidence,
        generalizationScore: candidate.generalizationScore
      });
      created += 1;
    }
  }

  return { created, updated };
}

async function runResearchCycle({
  trigger = "manual",
  createdBy = "system",
  sourceFilter = []
} = {}) {
  const startTime = Date.now();
  const sourceSet =
    Array.isArray(sourceFilter) && sourceFilter.length > 0
      ? new Set(sourceFilter.map((item) => String(item).toLowerCase()))
      : null;

  const selectedSources = RESEARCH_SOURCES.filter((source) =>
    sourceSet ? sourceSet.has(source.type) || sourceSet.has(source.name.toLowerCase()) : true
  );

  const sourceResults = [];
  const errors = [];
  let totalCreated = 0;
  let totalUpdated = 0;

  for (const source of selectedSources) {
    try {
      const candidates = await getSourceCandidates(source);
      const saveResult = await savePatternCandidates(candidates);
      totalCreated += saveResult.created;
      totalUpdated += saveResult.updated;

      sourceResults.push({
        source: source.name,
        status: "ok",
        fetchedCount: candidates.length,
        generatedPatterns: saveResult.created + saveResult.updated,
        summary: `Candidates=${candidates.length}, created=${saveResult.created}, updated=${saveResult.updated}`
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown research source failure";
      errors.push(`${source.name}: ${message}`);
      sourceResults.push({
        source: source.name,
        status: "error",
        fetchedCount: 0,
        generatedPatterns: 0,
        error: message
      });
    }
  }

  let promptEvolutionTriggered = false;
  if (totalCreated >= 5 && process.env.ENABLE_RESEARCH_PROMPT_EVOLUTION !== "false") {
    try {
      await evolvePrompts({
        promptTypes: ["planning", "chain", "learning"],
        createdBy: "research-cycle-auto"
      });
      promptEvolutionTriggered = true;
    } catch (error) {
      errors.push(
        `Prompt evolution trigger failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
    }
  }

  const summary = `Research cycle completed: sources=${selectedSources.length}, newPatterns=${totalCreated}, updatedPatterns=${totalUpdated}, errors=${errors.length}.`;
  const durationMs = Date.now() - startTime;

  const record = await ResearchLog.create({
    trigger,
    startedAt: new Date(startTime),
    completedAt: new Date(),
    durationMs,
    sourcesChecked: selectedSources.length,
    newPatternsCreated: totalCreated,
    promptEvolutionTriggered,
    summary,
    sourceResults,
    errors,
    createdBy
  });

  try {
    broadcastResearchUpdate({
      summary,
      newPatternsCreated: totalCreated,
      updatedPatterns: totalUpdated,
      promptEvolutionTriggered,
      runId: String(record._id)
    });
  } catch {
    // no-op for broadcast
  }

  return {
    runId: String(record._id),
    trigger,
    sourcesChecked: selectedSources.length,
    newPatternsCreated: totalCreated,
    updatedPatterns: totalUpdated,
    promptEvolutionTriggered,
    summary,
    sourceResults,
    errors
  };
}

async function getLatestResearchLog() {
  return ResearchLog.findOne({}).sort({ createdAt: -1 }).lean();
}

async function listResearchLogs(limit = 20) {
  const boundedLimit = Math.min(Math.max(toInteger(limit, 20), 1), 100);
  return ResearchLog.find({}).sort({ createdAt: -1 }).limit(boundedLimit).lean();
}

module.exports = {
  runResearchCycle,
  getLatestResearchLog,
  listResearchLogs,
  __internal: {
    inferTargetType,
    buildAssessmentSequence,
    mapCveToPatternCandidate,
    mapCisaKevToPatternCandidate,
    mapGithubAdvisoryToPatternCandidate
  }
};
