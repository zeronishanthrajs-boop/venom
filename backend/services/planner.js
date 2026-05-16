const fs = require("node:fs/promises");
const path = require("node:path");
const Pattern = require("../models/Pattern");
const CveSnapshot = require("../models/CveSnapshot");
const { resolvePromptContent } = require("./promptCatalog");
const { callGeminiText } = require("./geminiClient");

const PROMPT_VERSION = "planning_v2_3_2026_05_04";
const UNSAFE_TERMS =
  /exploit|payload|reverse shell|rce|privilege escalation|lateral movement|drop table|sqlmap/i;

function templatePlan(engagement) {
  const base = {
    summary:
      "Structured, authorization-first security assessment plan focused on verification and evidence collection.",
    phases: [],
    riskNotes: [
      "Pause immediately on any out-of-scope signal.",
      "Require human approval before any non-read-only action."
    ],
    disclaimers: [
      "Plan is restricted to authorized scope and approved constraints.",
      "No destructive testing is included."
    ]
  };

  if (engagement.targetType === "api") {
    base.phases = [
      {
        name: "API inventory",
        goal: "Map exposed endpoints and auth requirements.",
        priorityScore: 9,
        riskLevel: "low",
        checks: [
          "Enumerate documented endpoints and methods.",
          "Classify endpoints by authentication requirements.",
          "Validate rate-limit and error-response consistency."
        ],
        evidence: ["Endpoint map", "Auth matrix", "Rate-limit observations"],
        stopConditions: [
          "Unexpected production-only endpoint discovered.",
          "Any response indicating data beyond authorized scope."
        ]
      },
      {
        name: "Control validation",
        goal: "Verify common API security controls.",
        priorityScore: 8,
        riskLevel: "medium",
        checks: [
          "Check token handling and expiration behavior.",
          "Validate input handling and schema enforcement.",
          "Review CORS, caching, and security headers."
        ],
        evidence: ["Request/response samples", "Control checklist"],
        stopConditions: ["Potential sensitive data exposure detected."]
      }
    ];
  } else if (engagement.targetType === "network") {
    base.phases = [
      {
        name: "Surface discovery",
        goal: "Identify reachable assets and service inventory.",
        priorityScore: 9,
        riskLevel: "low",
        checks: [
          "List reachable hosts within approved ranges.",
          "Identify open ports and exposed service banners.",
          "Map services to approved asset inventory."
        ],
        evidence: ["Host list", "Service map", "Exposure summary"],
        stopConditions: ["Out-of-scope host appears in results."]
      },
      {
        name: "Configuration review",
        goal: "Validate secure baseline on discovered services.",
        priorityScore: 8,
        riskLevel: "medium",
        checks: [
          "Review TLS and certificate posture.",
          "Check protocol and service configuration hygiene.",
          "Flag unsupported or end-of-life software versions."
        ],
        evidence: ["Baseline checklist", "Version inventory"],
        stopConditions: ["Critical misconfiguration requiring urgent escalation."]
      }
    ];
  } else {
    base.phases = [
      {
        name: "Web surface mapping",
        goal: "Catalog pages, entry points, and auth boundaries.",
        priorityScore: 9,
        riskLevel: "low",
        checks: [
          "Enumerate reachable pages and forms in scope.",
          "Identify authentication and session boundaries.",
          "Capture HTTP security headers and TLS posture."
        ],
        evidence: ["Site map", "Auth boundary notes", "Header/TLS report"],
        stopConditions: ["Restricted path detected in crawl targets."]
      },
      {
        name: "App control checks",
        goal: "Validate common web application security controls.",
        priorityScore: 8,
        riskLevel: "medium",
        checks: [
          "Review input validation and output encoding behavior.",
          "Assess session management and cookie attributes.",
          "Check access-control behavior across user roles."
        ],
        evidence: ["Validation checklist", "Role-access matrix"],
        stopConditions: ["Potential data exposure beyond authorization."]
      }
    ];
  }

  return base;
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonObjectText(text) {
  const candidate = stripCodeFences(String(text || "").trim());
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  return candidate;
}

function normalizePlan(rawPlan) {
  const safePlan = {
    summary:
      typeof rawPlan.summary === "string" && rawPlan.summary.trim()
        ? rawPlan.summary.trim()
        : "Assessment plan generated.",
    phases: Array.isArray(rawPlan.phases) ? rawPlan.phases : [],
    riskNotes: Array.isArray(rawPlan.riskNotes) ? rawPlan.riskNotes : [],
    disclaimers: Array.isArray(rawPlan.disclaimers) ? rawPlan.disclaimers : []
  };

  safePlan.phases = safePlan.phases
    .map((phase) => {
      const checks = Array.isArray(phase.checks) ? phase.checks : [];
      const filteredChecks = checks.filter(
        (check) => typeof check === "string" && !UNSAFE_TERMS.test(check)
      );

      return {
        name: typeof phase.name === "string" ? phase.name : "Unnamed phase",
        goal: typeof phase.goal === "string" ? phase.goal : "No goal provided",
        priorityScore:
          Number.isFinite(Number(phase.priorityScore)) &&
          Number(phase.priorityScore) >= 1 &&
          Number(phase.priorityScore) <= 10
            ? Number(phase.priorityScore)
            : 5,
        riskLevel:
          typeof phase.riskLevel === "string" &&
          ["low", "medium", "high", "critical"].includes(
            phase.riskLevel.toLowerCase()
          )
            ? phase.riskLevel.toLowerCase()
            : "medium",
        checks: filteredChecks,
        evidence: Array.isArray(phase.evidence)
          ? phase.evidence.filter((item) => typeof item === "string")
          : [],
        stopConditions: Array.isArray(phase.stopConditions)
          ? phase.stopConditions.filter((item) => typeof item === "string")
          : []
      };
    })
    .filter((phase) => !UNSAFE_TERMS.test(`${phase.name} ${phase.goal}`));

  return safePlan;
}

function appendCveContextToTemplatePlan(plan, recentCves) {
  const cveHighlights = Array.isArray(recentCves) ? recentCves.slice(0, 3) : [];
  if (cveHighlights.length === 0) {
    return plan;
  }

  const cveNotes = cveHighlights.map((item) => {
    const severity = item.cvssSeverity || "UNKNOWN";
    const score = Number.isFinite(item.cvssScore) ? item.cvssScore.toFixed(1) : "n/a";
    return `Recent CVE context: ${item.cveId} (${severity}, CVSS ${score}) -> verify whether any exposed components match this vulnerability profile.`;
  });

  return {
    ...plan,
    riskNotes: [...(plan.riskNotes || []), ...cveNotes]
  };
}

function clamp01(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function extractLearningSignalsFromPatterns(patterns = []) {
  const scoredByCondition = new Map();

  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    const conditions = Array.isArray(pattern?.attackGraph?.conditions)
      ? pattern.attackGraph.conditions
      : [];

    for (const condition of conditions) {
      const conditionName = String(condition?.finding || "").trim();
      if (!conditionName) {
        continue;
      }

      const confidence = clamp01(condition?.confidence, 0.5);
      const learnedFrom = Math.max(0, Number(condition?.learnedFrom || 0));
      const successRate = clamp01(condition?.successRate, 0.5);
      const score =
        confidence * 0.45 +
        successRate * 0.35 +
        Math.min(1, learnedFrom / 10) * 0.2;

      const existing = scoredByCondition.get(conditionName);
      if (!existing || score > existing.score) {
        scoredByCondition.set(conditionName, {
          condition: conditionName,
          confidence: Number(confidence.toFixed(4)),
          learnedFrom,
          successRate: Number(successRate.toFixed(4)),
          score: Number(score.toFixed(4))
        });
      }
    }
  }

  return [...scoredByCondition.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);
}

function flattenRecommendationMap(recommendationMap = {}) {
  const flattened = [];
  for (const [condition, tools] of Object.entries(recommendationMap || {})) {
    for (const item of Array.isArray(tools) ? tools : []) {
      const tool = String(item?.tool || "").trim().toLowerCase();
      if (!tool) {
        continue;
      }
      flattened.push({
        condition,
        tool,
        paramAdjustment:
          item?.paramAdjustment && typeof item.paramAdjustment === "object"
            ? item.paramAdjustment
            : {},
        expectedSuccess: Number(clamp01(item?.expectedSuccess, 0.4).toFixed(4))
      });
    }
  }

  return flattened
    .sort((left, right) => right.expectedSuccess - left.expectedSuccess)
    .slice(0, 10);
}

function buildLearningRationale(learnedPatterns, learnedRecommendations) {
  if (!Array.isArray(learnedPatterns) || learnedPatterns.length === 0) {
    return "No learned attack patterns matched this engagement yet; planner used standard defensive sequencing.";
  }

  const patternSummary = learnedPatterns
    .slice(0, 3)
    .map(
      (pattern) =>
        `${pattern.condition} (${Math.round(clamp01(pattern.confidence) * 100)}% confidence)`
    )
    .join(", ");

  if (!Array.isArray(learnedRecommendations) || learnedRecommendations.length === 0) {
    return `Plan informed by ${learnedPatterns.length} learned pattern(s): ${patternSummary}.`;
  }

  const topTools = learnedRecommendations
    .slice(0, 3)
    .map((item) => item.tool)
    .join(", ");
  return `Plan informed by ${learnedPatterns.length} learned pattern(s): ${patternSummary}. Prioritized tools: ${topTools}.`;
}

function computeLearningConfidence(learnedPatterns, learnedRecommendations) {
  if (!Array.isArray(learnedPatterns) || learnedPatterns.length === 0) {
    return 0.68;
  }

  const avgPatternConfidence =
    learnedPatterns.reduce((sum, item) => sum + clamp01(item.confidence, 0.5), 0) /
    learnedPatterns.length;
  const recommendationBoost = Math.min(
    0.18,
    (Array.isArray(learnedRecommendations) ? learnedRecommendations.length : 0) * 0.03
  );
  return Number(
    Math.max(0.6, Math.min(0.97, avgPatternConfidence * 0.82 + 0.12 + recommendationBoost)).toFixed(4)
  );
}

function appendLearningContextToPlan(plan, learnedPatterns = []) {
  if (!Array.isArray(learnedPatterns) || learnedPatterns.length === 0) {
    return plan;
  }

  const learningNote = `Learning signals applied: ${learnedPatterns
    .map(
      (item) =>
        `${item.condition} (${Math.round(clamp01(item.successRate) * 100)}% observed success)`
    )
    .join("; ")}`;

  const existingNotes = Array.isArray(plan?.riskNotes) ? plan.riskNotes : [];
  if (existingNotes.includes(learningNote)) {
    return plan;
  }

  return {
    ...plan,
    riskNotes: [...existingNotes, learningNote]
  };
}

async function deriveLearningMetadataFromPlannerContext(plannerContext) {
  const learnedPatterns = extractLearningSignalsFromPatterns(
    plannerContext?.rawPatterns || []
  ).map((item) => ({
    condition: item.condition,
    confidence: item.confidence,
    learnedFrom: item.learnedFrom,
    successRate: item.successRate
  }));

  let recommendationMap = {};
  const conditionKeys = learnedPatterns.map((item) => item.condition);
  if (conditionKeys.length > 0) {
    try {
      const { getRecommendedTools } = require("./attackGraphService");
      recommendationMap = await getRecommendedTools(conditionKeys);
    } catch {
      recommendationMap = {};
    }
  }

  const learnedRecommendations = flattenRecommendationMap(recommendationMap);
  return {
    learnedPatterns,
    learnedRecommendations,
    rationale: buildLearningRationale(learnedPatterns, learnedRecommendations),
    confidence: computeLearningConfidence(learnedPatterns, learnedRecommendations)
  };
}

async function loadSystemPrompt() {
  const promptPath = path.join(__dirname, "..", "prompts", "planning-agent-v2.txt");
  let fallbackText = "";
  try {
    fallbackText = await fs.readFile(promptPath, "utf8");
  } catch {
    fallbackText = "";
  }

  const resolved = await resolvePromptContent("planning", fallbackText);
  return resolved;
}

async function loadPlannerContext(engagement) {
  const [patterns, recentCves] = await Promise.all([
    Pattern.find({
      $or: [{ targetType: engagement.targetType }, { targetType: "mixed" }]
    })
      .sort({ confidence: -1, recentSuccessRate: -1 })
      .limit(8)
      .lean(),
    CveSnapshot.find({})
      .sort({ publishedAt: -1, cvssScore: -1 })
      .limit(12)
      .lean()
  ]);

  return {
    patterns: patterns.map((pattern) => ({
      name: pattern.name,
      description: pattern.description,
      targetType: pattern.targetType,
      confidence: pattern.confidence,
      recentSuccessRate: pattern.recentSuccessRate,
      tags: pattern.tags || [],
      learnedConditions: Array.isArray(pattern.attackGraph?.conditions)
        ? pattern.attackGraph.conditions.slice(0, 4).map((condition) => ({
            finding: condition.finding,
            confidence: condition.confidence,
            successRate: condition.successRate
          }))
        : []
    })),
    rawPatterns: patterns,
    recentCves: recentCves.map((cve) => ({
      cveId: cve.cveId,
      description: cve.description,
      cvssScore: cve.cvssScore,
      cvssSeverity: cve.cvssSeverity,
      tags: cve.applicabilityTags || cve.tags || [],
      venomRelevanceScore: cve.venomRelevanceScore || 0,
      cweIds: cve.cweIds || [],
      publishedAt: cve.publishedAt
    }))
  };
}

function buildUserPayload(engagement) {
  return {
    target: {
      name: engagement.name,
      description: engagement.description,
      url: engagement.targetUrl,
      type: engagement.targetType
    },
    scope: engagement.scope,
    authorization: {
      engagementId: engagement.authorization?.engagementId,
      authorizedBy: engagement.authorization?.authorizedBy,
      validFrom: engagement.authorization?.validFrom,
      validUntil: engagement.authorization?.validUntil,
      scopeOfWork: engagement.authorization?.scopeOfWork
    },
    constraints: engagement.constraints
  };
}

function uniqueModels(models = []) {
  const seen = new Set();
  const output = [];
  for (const model of models) {
    const normalized = String(model || "").trim();
    if (!normalized) {
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output;
}

function getPlannerModelCandidates() {
  const primary = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const fallbackCsv = String(process.env.GEMINI_FALLBACK_MODELS || "");
  const fallbacks = fallbackCsv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return uniqueModels([primary, ...fallbacks]);
}

function summarizeGeminiPlannerFailure(error, modelCandidates = []) {
  const raw = String(error?.message || "Unknown Gemini planner error");
  const modelsText = modelCandidates.length > 0 ? modelCandidates.join(", ") : "n/a";
  const normalized = raw.toLowerCase();
  const statusMatch = raw.match(/\bwith\s+(\d{3})\b/i);
  const statusCode = statusMatch ? Number(statusMatch[1]) : null;

  if (statusCode === 401 || statusCode === 403 || normalized.includes("permission")) {
    return `Gemini rejected the request (auth/permission). Verify GEMINI_API_KEY access for models [${modelsText}].`;
  }

  if (statusCode === 404 || normalized.includes("not found")) {
    return `Gemini model unavailable for current key. Check GEMINI_MODEL/GEMINI_FALLBACK_MODELS [${modelsText}].`;
  }

  if (statusCode === 429 || normalized.includes("quota")) {
    return "Gemini quota/rate limit reached. Retry later or adjust usage limits.";
  }

  if (statusCode && statusCode >= 500) {
    return "Gemini upstream service error. Retry shortly; fallback template applied.";
  }

  return `Gemini planner request failed: ${raw.slice(0, 220)}`;
}

async function callGeminiPlanner(engagement, plannerContextInput) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const modelCandidates = getPlannerModelCandidates();
  const [systemPromptSource, plannerContext] = await Promise.all([
    loadSystemPrompt(),
    plannerContextInput ? Promise.resolve(plannerContextInput) : loadPlannerContext(engagement)
  ]);
  const systemPrompt = systemPromptSource.content || "";
  const userPayload = buildUserPayload(engagement);
  const contextualSystemPrompt = `${systemPrompt}

Context to improve planning quality:
- Historical defensive patterns with confidence/success metadata
- Recent CVE intelligence snapshot to prioritize verification checks

PATTERN_CONTEXT:
${JSON.stringify(plannerContext.patterns, null, 2)}

CVE_CONTEXT:
${JSON.stringify(plannerContext.recentCves, null, 2)}

Safety constraints:
- Do not propose offensive exploitation instructions.
- Focus on authorized validation, evidence collection, and mitigation-oriented reasoning.`;

  let lastError = null;
  for (const model of modelCandidates) {
    try {
      const geminiResponse = await callGeminiText({
        apiKey,
        model,
        systemInstruction: contextualSystemPrompt,
        userPrompt: `Generate a safe assessment plan for this engagement.\n\n${JSON.stringify(
          userPayload,
          null,
          2
        )}`,
        temperature: 0.2,
        maxOutputTokens: 1200
      });
      const rawText = geminiResponse.text || "";

      let parsed;
      try {
        parsed = JSON.parse(extractJsonObjectText(rawText));
      } catch {
        const repairModel = process.env.GEMINI_JSON_REPAIR_MODEL || model;
        const repairResponse = await callGeminiText({
          apiKey,
          model: repairModel,
          userPrompt: `Convert the following text into strict valid JSON that matches VENOM plan schema. Output JSON only.\n\n${rawText}`,
          temperature: 0,
          maxOutputTokens: 1200,
          responseMimeType: "application/json"
        }).catch((error) => {
          throw new Error(`Gemini JSON repair failed: ${error?.message || "Unknown error"}`);
        });
        const repairText = repairResponse?.text || "";
        parsed = JSON.parse(extractJsonObjectText(repairText));
      }

      return {
        source: "gemini-api",
        model,
        promptVersion:
          systemPromptSource?.source === "db-active"
            ? systemPromptSource.version
            : PROMPT_VERSION,
        plan: normalizePlan(parsed),
        rawModelOutput: rawText
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    summarizeGeminiPlannerFailure(lastError, modelCandidates)
  );
}

async function generatePlanForEngagement(engagement) {
  const { logger, withMaskedSecrets } = require("../config/logger");
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const plannerModels = getPlannerModelCandidates();
  const plannerModel = plannerModels[0] || "gemini-2.0-flash";
  const strictPlanner = process.env.GEMINI_PLANNER_STRICT === "true";
  logger.info(
    withMaskedSecrets({
      hasApiKey: hasGeminiKey,
      model: plannerModel,
      engagementId: String(engagement?._id || "")
    }),
    "Planner generation attempt"
  );

  const plannerContext = await loadPlannerContext(engagement);
  const learningMetadata = await deriveLearningMetadataFromPlannerContext(plannerContext);
  if (!hasGeminiKey) {
    logger.warn("No GEMINI_API_KEY configured, using template fallback");
    const fallbackPlan = appendLearningContextToPlan(
      appendCveContextToTemplatePlan(
        normalizePlan(templatePlan(engagement)),
        plannerContext.recentCves
      ),
      learningMetadata.learnedPatterns
    );
    return {
      source: "template",
      model: "template-planner-v1",
      promptVersion: PROMPT_VERSION,
      fallbackReason: "GEMINI_API_KEY is not configured",
      plan: fallbackPlan,
      rawModelOutput: "",
      ...learningMetadata
    };
  }

  let geminiFailureReason = "";
  const geminiResult = await callGeminiPlanner(engagement, plannerContext).catch((error) => {
    if (hasGeminiKey && strictPlanner) {
      throw error;
    }
    geminiFailureReason = summarizeGeminiPlannerFailure(error, plannerModels);
    logger.error(
      {
        error: error?.message || "Unknown error",
        type: error?.constructor?.name || "Unknown",
        status: error?.status || error?.statusCode || error?.code || "N/A",
        fallbackReason: geminiFailureReason
      },
      "Gemini API planner request failed"
    );
    logger.warn("Gemini planner unavailable, using template fallback.");
    return null;
  });

  if (geminiResult) {
    logger.info("Gemini planner request succeeded");
    const learnedGeminiPlan = appendLearningContextToPlan(
      geminiResult.plan,
      learningMetadata.learnedPatterns
    );
    return {
      ...geminiResult,
      promptVersion: geminiResult.promptVersion || PROMPT_VERSION,
      plan: learnedGeminiPlan,
      ...learningMetadata
    };
  }

  const fallbackPlan = appendLearningContextToPlan(
    appendCveContextToTemplatePlan(
      normalizePlan(templatePlan(engagement)),
      plannerContext.recentCves
    ),
    learningMetadata.learnedPatterns
  );
  return {
    source: "template",
    model: "template-planner-v1",
    promptVersion: PROMPT_VERSION,
    fallbackReason:
      geminiFailureReason || "Gemini API request failed; template fallback applied",
    plan: fallbackPlan,
    rawModelOutput: "",
    ...learningMetadata
  };
}

module.exports = {
  generatePlanForEngagement,
  PROMPT_VERSION
};
