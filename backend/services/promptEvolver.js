const fs = require("node:fs/promises");
const path = require("node:path");
const PromptVersion = require("../models/PromptVersion");
const ExecutionJob = require("../models/ExecutionJob");
const Engagement = require("../models/Engagement");
const { extractFindingCount } = require("./metricsEngine");
const { resolvePromptContent, normalizePromptType } = require("./promptCatalog");

const SUPPORTED_PROMPT_TYPES = ["planning", "chain", "learning"];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timestampToken(date = new Date()) {
  return date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function extractJsonObjectText(text) {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

async function computePerformanceMetrics(limit = 20) {
  const engagements = await Engagement.find({})
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  if (engagements.length === 0) {
    return {
      totalEngagementsUsed: 0,
      avgFindingsPerEngagement: 0,
      avgPlanQualityScore: 0,
      successRate: 0,
      byTargetType: {}
    };
  }

  const jobs = await ExecutionJob.find({
    engagementId: { $in: engagements.map((item) => item._id) }
  }).lean();
  const jobsByEngagement = new Map();
  for (const job of jobs) {
    const key = String(job.engagementId);
    if (!jobsByEngagement.has(key)) {
      jobsByEngagement.set(key, []);
    }
    jobsByEngagement.get(key).push(job);
  }

  let findingsTotal = 0;
  let terminalCount = 0;
  let successCount = 0;
  const byTargetType = {};

  for (const engagement of engagements) {
    const key = String(engagement._id);
    const targetType = engagement.targetType || "website";
    const engagementJobs = jobsByEngagement.get(key) || [];
    const engagementFindings = engagementJobs.reduce(
      (sum, job) => sum + extractFindingCount(job),
      0
    );

    findingsTotal += engagementFindings;

    for (const job of engagementJobs) {
      if (["success", "failed", "timeout", "blocked"].includes(job.status)) {
        terminalCount += 1;
        if (job.status === "success") {
          successCount += 1;
        }
      }
    }

    if (!byTargetType[targetType]) {
      byTargetType[targetType] = {
        engagements: 0,
        findings: 0
      };
    }
    byTargetType[targetType].engagements += 1;
    byTargetType[targetType].findings += engagementFindings;
  }

  return {
    totalEngagementsUsed: engagements.length,
    avgFindingsPerEngagement: Number((findingsTotal / engagements.length).toFixed(4)),
    avgPlanQualityScore: Number(
      Math.min(1, findingsTotal / Math.max(engagements.length * 10, 1)).toFixed(4)
    ),
    successRate:
      terminalCount === 0 ? 0 : Number((successCount / terminalCount).toFixed(4)),
    byTargetType
  };
}

function buildEvolutionPrompt({ promptType, currentPrompt, metrics }) {
  return [
    "You are VENOM's autonomous prompt engineer focused on safe, authorized security validation.",
    `Prompt type: ${promptType}`,
    "",
    "Current prompt:",
    currentPrompt,
    "",
    "Recent performance metrics:",
    JSON.stringify(metrics, null, 2),
    "",
    "Return STRICT JSON only with this shape:",
    "{",
    '  "improvedPrompt": "string",',
    '  "changes": ["string"],',
    '  "expectedImpact": "string",',
    '  "confidenceScore": 0.0',
    "}",
    "",
    "Rules:",
    "- Keep recommendations non-destructive and authorization-first.",
    "- Do not output exploitation payloads or offensive instructions.",
    "- Improve reasoning quality, ordering, and decision clarity."
  ].join("\n");
}

async function callClaudeForEvolution(promptPayload) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model =
    process.env.CLAUDE_PROMPT_EVOLVER_MODEL ||
    process.env.CLAUDE_MODEL ||
    "claude-3-5-sonnet-latest";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1600,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: promptPayload
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Claude evolution request failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const text = Array.isArray(payload?.content)
    ? payload.content.find((item) => item?.type === "text")?.text || ""
    : "";
  return { text, model };
}

async function saveEvolvedPromptToFile(promptType, content) {
  const generatedDir = path.join(__dirname, "..", "prompts", "generated");
  await fs.mkdir(generatedDir, { recursive: true });
  const filePath = path.join(generatedDir, `${promptType}-agent-evolved.txt`);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function evolvePromptType(promptType, options = {}) {
  const normalized = normalizePromptType(promptType);
  if (!normalized || !SUPPORTED_PROMPT_TYPES.includes(normalized)) {
    return {
      promptType,
      status: "skipped",
      reason: "unsupported_prompt_type"
    };
  }

  const metrics = options.metrics || (await computePerformanceMetrics());
  const currentRecord = await PromptVersion.findOne({
    promptType: normalized,
    isActive: true
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
  const resolved = await resolvePromptContent(normalized);
  const currentPrompt = resolved.content || "";
  if (!currentPrompt.trim()) {
    return {
      promptType: normalized,
      status: "skipped",
      reason: "no_prompt_source"
    };
  }

  const response = await callClaudeForEvolution(
    buildEvolutionPrompt({
      promptType: normalized,
      currentPrompt,
      metrics
    })
  );

  if (!response) {
    return {
      promptType: normalized,
      status: "skipped",
      reason: "claude_api_key_missing"
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJsonObjectText(response.text));
  } catch {
    return {
      promptType: normalized,
      status: "skipped",
      reason: "invalid_model_json"
    };
  }

  const confidenceThreshold = toNumber(process.env.PROMPT_EVOLUTION_MIN_CONFIDENCE, 0.7);
  const confidenceScore = toNumber(parsed?.confidenceScore, 0);
  if (confidenceScore < confidenceThreshold) {
    return {
      promptType: normalized,
      status: "skipped",
      reason: "low_confidence",
      confidenceScore
    };
  }

  const improvedPrompt = String(parsed?.improvedPrompt || "").trim();
  if (!improvedPrompt) {
    return {
      promptType: normalized,
      status: "skipped",
      reason: "empty_improved_prompt"
    };
  }

  const version = `${normalized}_v${timestampToken()}`;
  await PromptVersion.updateMany({ promptType: normalized }, { $set: { isActive: false } });
  const created = await PromptVersion.create({
    promptType: normalized,
    version,
    content: improvedPrompt,
    parentVersion: currentRecord?.version || "base",
    evolutionReason: Array.isArray(parsed?.changes)
      ? parsed.changes.map((item) => String(item)).join("; ")
      : String(parsed?.expectedImpact || "Automated prompt refinement."),
    performanceMetrics: {
      avgFindingsPerEngagement: metrics.avgFindingsPerEngagement,
      avgPlanQualityScore: metrics.avgPlanQualityScore,
      totalEngagementsUsed: metrics.totalEngagementsUsed,
      successRate: metrics.successRate
    },
    isActive: true,
    createdByAI: true,
    createdBy: options.createdBy || "venom-system"
  });

  const filePath = await saveEvolvedPromptToFile(normalized, improvedPrompt);
  return {
    promptType: normalized,
    status: "evolved",
    version: created.version,
    sourceModel: response.model,
    confidenceScore,
    filePath
  };
}

async function evolvePrompts(options = {}) {
  const promptTypes = Array.isArray(options.promptTypes) && options.promptTypes.length > 0
    ? options.promptTypes
    : SUPPORTED_PROMPT_TYPES;

  const metrics = await computePerformanceMetrics();
  const results = [];
  for (const promptType of promptTypes) {
    // eslint-disable-next-line no-await-in-loop
    const result = await evolvePromptType(promptType, {
      metrics,
      createdBy: options.createdBy || "venom-system"
    });
    results.push(result);
  }

  return {
    triggeredAt: new Date().toISOString(),
    metrics,
    results,
    evolvedCount: results.filter((item) => item.status === "evolved").length,
    skippedCount: results.filter((item) => item.status !== "evolved").length
  };
}

async function getPromptHistory({ promptType, limit = 50 } = {}) {
  const normalized = promptType ? normalizePromptType(promptType) : null;
  const query = normalized ? { promptType: normalized } : {};
  const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return PromptVersion.find(query)
    .sort({ createdAt: -1 })
    .limit(boundedLimit)
    .lean();
}

async function ensureActivePromptBaselines() {
  const existingActiveCount = await PromptVersion.countDocuments({
    isActive: true,
    promptType: { $in: SUPPORTED_PROMPT_TYPES }
  });
  if (existingActiveCount > 0) {
    return;
  }

  const createdAtToken = timestampToken();
  for (const promptType of SUPPORTED_PROMPT_TYPES) {
    // eslint-disable-next-line no-await-in-loop
    const resolved = await resolvePromptContent(promptType);
    const content = String(resolved?.content || "").trim();
    if (!content) {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    await PromptVersion.findOneAndUpdate(
      {
        promptType,
        version: `${promptType}_baseline_${createdAtToken}`
      },
      {
        $set: {
          content,
          parentVersion: "base",
          evolutionReason: "Baseline prompt imported from file source.",
          performanceMetrics: {
            avgFindingsPerEngagement: 0,
            avgPlanQualityScore: 0,
            totalEngagementsUsed: 0,
            successRate: 0
          },
          isActive: true,
          createdByAI: false,
          createdBy: "venom-bootstrap"
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );
  }
}

async function getActivePrompts() {
  await ensureActivePromptBaselines();
  return PromptVersion.find({ isActive: true })
    .sort({ promptType: 1, createdAt: -1 })
    .lean();
}

module.exports = {
  SUPPORTED_PROMPT_TYPES,
  extractJsonObjectText,
  computePerformanceMetrics,
  evolvePromptType,
  evolvePrompts,
  getPromptHistory,
  getActivePrompts
};
