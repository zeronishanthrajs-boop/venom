const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const Pattern = require("../models/Pattern");
const {
  appendRecentOutcomes,
  computeConfidence,
  computeRecentSuccessRate,
  computeSuccessRate
} = require("./patternEngine");

const SAFE_TARGET_TYPES = new Set(["website", "api", "network", "mixed"]);
const SAFE_TAGS = new Set([
  "web",
  "api",
  "network",
  "tls",
  "dns",
  "auth",
  "idor",
  "xss",
  "sqli",
  "ssrf",
  "misconfiguration",
  "information-disclosure",
  "header-hardening",
  "known-cve",
  "compliance",
  "cms",
  "container",
  "cloud"
]);

function toSafeTargetType(value) {
  if (!value) {
    return "website";
  }
  const normalized = String(value).toLowerCase();
  if (SAFE_TARGET_TYPES.has(normalized)) {
    return normalized;
  }
  if (normalized === "web") {
    return "website";
  }
  return "mixed";
}

function sanitizeTags(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return [...new Set(
    input
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter((tag) => SAFE_TAGS.has(tag))
  )].slice(0, 8);
}

function normalizePatternName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function severityToTag(severity) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized === "critical" || normalized === "high") {
    return "known-cve";
  }
  if (normalized === "medium") {
    return "misconfiguration";
  }
  return "";
}

function inferTagsFromFinding(finding = {}) {
  const tags = new Set();
  const category = String(finding.category || "").toLowerCase();
  const title = String(finding.title || "").toLowerCase();
  const description = String(finding.description || "").toLowerCase();

  if (category) {
    tags.add(category);
  }

  const sevTag = severityToTag(finding.severity);
  if (sevTag) {
    tags.add(sevTag);
  }

  if (/csp|security header|hsts|x-content-type-options/.test(`${title} ${description}`)) {
    tags.add("header-hardening");
    tags.add("misconfiguration");
    tags.add("web");
  }
  if (/sql|sqli|injection/.test(`${title} ${description}`)) {
    tags.add("sqli");
    tags.add("api");
  }
  if (/xss|cross-site/.test(`${title} ${description}`)) {
    tags.add("xss");
    tags.add("web");
  }
  if (/ssrf/.test(`${title} ${description}`)) {
    tags.add("ssrf");
    tags.add("web");
  }
  if (/auth|token|session|credential/.test(`${title} ${description}`)) {
    tags.add("auth");
  }
  if (/dns|resolver|record/.test(`${title} ${description}`)) {
    tags.add("dns");
    tags.add("network");
  }
  if (/tls|certificate|cipher|ssl/.test(`${title} ${description}`)) {
    tags.add("tls");
    tags.add("network");
    tags.add("web");
  }
  if (/cve-\d{4}-\d+/i.test(`${title} ${description} ${finding.cve || ""}`)) {
    tags.add("known-cve");
  }
  if (/wordpress|drupal|joomla|plugin|theme/.test(`${title} ${description}`)) {
    tags.add("cms");
    tags.add("web");
  }

  return sanitizeTags([...tags]);
}

function deriveFindingCollection(job) {
  if (Array.isArray(job.findings) && job.findings.length > 0) {
    return job.findings;
  }
  if (Array.isArray(job.output?.findings) && job.output.findings.length > 0) {
    return job.output.findings;
  }
  return [];
}

function jobIsSuccessful(job) {
  if (job.status === "success") {
    return true;
  }
  return deriveFindingCollection(job).length > 0;
}

function buildJobSummary(job) {
  const findings = deriveFindingCollection(job);
  return {
    toolId: job.toolId,
    targetUrl: job.targetUrl,
    status: job.status,
    findings: findings.map((finding) => ({
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      description: finding.description,
      cve: finding.cve || null
    })),
    technologyFingerprint: job.output?.technologyFingerprint || null
  };
}

function buildHeuristicPatternCandidates({ jobs, engagementTargetType }) {
  const buckets = new Map();

  for (const job of jobs) {
    const findings = deriveFindingCollection(job);
    for (const finding of findings) {
      const tags = inferTagsFromFinding(finding);
      const primaryCategory = tags[0] || "misconfiguration";
      const key = `${engagementTargetType}:${primaryCategory}`;
      const existing = buckets.get(key) || {
        count: 0,
        tags: new Set([primaryCategory, engagementTargetType]),
        titles: new Set()
      };
      existing.count += 1;
      if (finding.title) {
        existing.titles.add(finding.title);
      }
      tags.forEach((tag) => existing.tags.add(tag));
      buckets.set(key, existing);
    }
  }

  const candidates = [];
  for (const [key, value] of buckets.entries()) {
    if (value.count < 2) {
      continue;
    }
    const [, primaryCategory] = key.split(":");
    const baseName = `heuristic_${engagementTargetType}_${primaryCategory}_validation`;
    const patternName = normalizePatternName(baseName);
    candidates.push({
      name: patternName,
      description: `Derived validation pattern focused on ${primaryCategory} signals across recent execution jobs.`,
      targetType: toSafeTargetType(engagementTargetType),
      tags: sanitizeTags([...value.tags]),
      prerequisites: ["authorized_scope", "read_only_checks"],
      assessmentSequence: [
        "Collect baseline telemetry and response metadata.",
        "Validate control behavior for repeated weakness indicators.",
        "Document evidence and remediation guidance."
      ],
      estimatedSuccessRate: 0.55,
      generalizationScore: 0.65
    });
  }

  return candidates;
}

function extractJsonArray(text) {
  const candidate = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const first = candidate.indexOf("[");
  const last = candidate.lastIndexOf("]");
  if (first >= 0 && last > first) {
    return candidate.slice(first, last + 1);
  }
  return candidate;
}

async function extractClaudePatternCandidates(successfulJobs) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || successfulJobs.length === 0) {
    return [];
  }

  const summary = successfulJobs.map(buildJobSummary);
  const model = process.env.CLAUDE_LEARNER_MODEL || process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest";

  const prompt = [
    "You are VENOM's defensive learning assistant.",
    "Given completed security validation job outputs, extract NEW reusable defensive assessment patterns.",
    "Do not provide exploit instructions, payloads, privilege escalation steps, or offensive chains.",
    "Output strictly a JSON array with objects containing:",
    '{ "name": string, "description": string, "targetType": "website"|"api"|"network"|"mixed", "tags": string[], "prerequisites": string[], "assessmentSequence": string[], "estimatedSuccessRate": number, "generalizationScore": number }',
    "Only include patterns with generalizationScore >= 0.6.",
    "Return [] if nothing new is extractable.",
    "",
    "Job summary:",
    JSON.stringify(summary, null, 2)
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    return [];
  }

  const payload = await response.json();
  const text = Array.isArray(payload?.content)
    ? payload.content.find((item) => item?.type === "text")?.text || ""
    : "";

  try {
    const parsed = JSON.parse(extractJsonArray(text));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function sanitizePatternCandidate(candidate, engagementTargetType) {
  const name = normalizePatternName(candidate?.name);
  if (!name) {
    return null;
  }

  const generalizationScore = Number(candidate?.generalizationScore);
  if (!Number.isFinite(generalizationScore) || generalizationScore < 0.6) {
    return null;
  }

  const estimatedSuccessRate = Number(candidate?.estimatedSuccessRate);
  const safeSuccessRate = Number.isFinite(estimatedSuccessRate)
    ? Math.max(0, Math.min(1, estimatedSuccessRate))
    : 0.5;

  return {
    name,
    description: String(candidate?.description || "Auto-extracted defensive validation pattern."),
    targetType: toSafeTargetType(candidate?.targetType || engagementTargetType),
    tags: sanitizeTags(candidate?.tags || []),
    prerequisites: Array.isArray(candidate?.prerequisites)
      ? candidate.prerequisites.map((item) => String(item || "")).filter(Boolean).slice(0, 8)
      : [],
    assessmentSequence: Array.isArray(candidate?.assessmentSequence)
      ? candidate.assessmentSequence.map((item) => String(item || "")).filter(Boolean).slice(0, 8)
      : [],
    estimatedSuccessRate: safeSuccessRate,
    generalizationScore: Math.min(1, generalizationScore)
  };
}

async function upsertPatternOutcome({
  engagementTargetType,
  toolId,
  tags,
  outcome
}) {
  const patternName = normalizePatternName(`baseline_${toolId}`);
  const pattern = (await Pattern.findOne({ name: patternName })) ||
    new Pattern({
      name: patternName,
      description: `Baseline defensive validation pattern derived from ${toolId} outcomes.`,
      targetType: toSafeTargetType(engagementTargetType),
      tags: sanitizeTags([toolId, engagementTargetType, ...tags]),
      source: "execution-telemetry"
    });

  pattern.successCount += outcome ? 1 : 0;
  pattern.failureCount += outcome ? 0 : 1;
  pattern.successRate = computeSuccessRate(pattern.successCount, pattern.failureCount);
  pattern.recentOutcomes = appendRecentOutcomes(pattern.recentOutcomes, [outcome]);
  pattern.recentSuccessRate = computeRecentSuccessRate(pattern.recentOutcomes);
  pattern.confidence = computeConfidence(
    pattern.successRate,
    pattern.recentSuccessRate,
    pattern.successCount + pattern.failureCount
  );
  pattern.lastUsedAt = new Date();
  pattern.tags = sanitizeTags([...(pattern.tags || []), ...tags, toolId, engagementTargetType]);
  await pattern.save();
  return pattern;
}

async function createNewPatternsFromCandidates(candidates, sourceLabel) {
  const created = [];
  for (const candidate of candidates) {
    const exists = await Pattern.findOne({ name: candidate.name }).lean();
    if (exists) {
      continue;
    }

    const confidence = Number(
      (candidate.estimatedSuccessRate * candidate.generalizationScore).toFixed(4)
    );

    const pattern = await Pattern.create({
      name: candidate.name,
      description: candidate.description,
      targetType: candidate.targetType,
      tags: candidate.tags,
      prerequisites: candidate.prerequisites,
      assessmentSequence: candidate.assessmentSequence,
      successCount: 1,
      failureCount: 0,
      successRate: candidate.estimatedSuccessRate,
      recentOutcomes: [true],
      recentSuccessRate: 1,
      confidence,
      generalizationScore: candidate.generalizationScore,
      source: sourceLabel,
      lastUsedAt: new Date()
    });
    created.push(pattern);
  }
  return created;
}

async function runLearningCycle(engagementId) {
  const engagement = await Engagement.findById(engagementId).lean();
  if (!engagement) {
    return {
      error: "Engagement not found"
    };
  }

  const jobs = await ExecutionJob.find({
    engagementId,
    status: { $in: ["success", "failed", "timeout", "blocked"] },
    learnedAt: { $exists: false }
  })
    .sort({ createdAt: -1 })
    .lean();

  if (jobs.length === 0) {
    return {
      engagementId,
      processedJobs: 0,
      updatedPatterns: [],
      newPatternsExtracted: 0,
      extractionSource: "none",
      message: "No new execution jobs to learn from."
    };
  }

  const updatedPatterns = [];
  for (const job of jobs) {
    const findings = deriveFindingCollection(job);
    const inferredTags = findings.flatMap((finding) => inferTagsFromFinding(finding));
    const outputTags = Array.isArray(job.output?.applicabilityTags)
      ? job.output.applicabilityTags
      : [];
    const tags = sanitizeTags([...(inferredTags || []), ...(outputTags || [])]);
    const outcome = jobIsSuccessful(job);
    const pattern = await upsertPatternOutcome({
      engagementTargetType: engagement.targetType,
      toolId: job.toolId,
      tags,
      outcome
    });

    updatedPatterns.push({
      patternId: pattern._id,
      name: pattern.name,
      successCount: pattern.successCount,
      failureCount: pattern.failureCount,
      successRate: pattern.successRate,
      recentSuccessRate: pattern.recentSuccessRate,
      confidence: pattern.confidence
    });
  }

  const successfulJobs = jobs.filter((job) => jobIsSuccessful(job));
  const rawCandidates = await extractClaudePatternCandidates(successfulJobs);
  const sanitizedClaude = rawCandidates
    .map((candidate) => sanitizePatternCandidate(candidate, engagement.targetType))
    .filter(Boolean);

  let extractionSource = "claude";
  let candidates = sanitizedClaude;

  if (candidates.length === 0) {
    extractionSource = "heuristic";
    candidates = buildHeuristicPatternCandidates({
      jobs: successfulJobs,
      engagementTargetType: engagement.targetType
    });
  }

  const sourceLabel =
    extractionSource === "claude" ? "claude-extracted" : "heuristic-extracted";
  const createdPatterns = await createNewPatternsFromCandidates(candidates, sourceLabel);

  await ExecutionJob.updateMany(
    {
      _id: { $in: jobs.map((job) => job._id) }
    },
    {
      $set: { learnedAt: new Date() }
    }
  );

  return {
    engagementId,
    processedJobs: jobs.length,
    successfulJobs: successfulJobs.length,
    updatedPatterns,
    newPatternsExtracted: createdPatterns.length,
    extractionSource,
    message:
      createdPatterns.length > 0
        ? `Learning cycle completed and ${createdPatterns.length} new pattern(s) were extracted.`
        : "Learning cycle completed with baseline updates only."
  };
}

module.exports = {
  inferTagsFromFinding,
  buildHeuristicPatternCandidates,
  sanitizePatternCandidate,
  runLearningCycle
};
