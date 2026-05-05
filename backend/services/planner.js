const fs = require("node:fs/promises");
const path = require("node:path");
const Pattern = require("../models/Pattern");
const CveSnapshot = require("../models/CveSnapshot");
const { resolvePromptContent } = require("./promptCatalog");

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
      tags: pattern.tags || []
    })),
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

async function callClaudePlanner(engagement, plannerContextInput) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
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
      system: contextualSystemPrompt,
      messages: [
        {
          role: "user",
          content: `Generate a safe assessment plan for this engagement.\n\n${JSON.stringify(
            userPayload,
            null,
            2
          )}`
        }
      ]
    })
  });

  if (!response.ok) {
    const failureText = await response.text();
    throw new Error(
      `Claude API request failed with ${response.status}: ${failureText}`
    );
  }

  const payload = await response.json();
  const textBlock = Array.isArray(payload.content)
    ? payload.content.find((item) => item?.type === "text")
    : null;
  const rawText = textBlock?.text || "";

  let parsed;
  try {
    parsed = JSON.parse(extractJsonObjectText(rawText));
  } catch {
    const repairModel = process.env.CLAUDE_JSON_REPAIR_MODEL || model;
    const repairResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: repairModel,
        max_tokens: 1200,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: `Convert the following text into strict valid JSON that matches VENOM plan schema. Output JSON only.\n\n${rawText}`
          }
        ]
      })
    });

    if (!repairResponse.ok) {
      const repairFailure = await repairResponse.text().catch(() => "");
      throw new Error(
        `Claude JSON repair failed (${repairResponse.status}): ${repairFailure}`
      );
    }

    const repairPayload = await repairResponse.json();
    const repairText = Array.isArray(repairPayload?.content)
      ? repairPayload.content.find((item) => item?.type === "text")?.text || ""
      : "";
    parsed = JSON.parse(extractJsonObjectText(repairText));
  }

  return {
    source: "claude-api",
    model,
    promptVersion:
      systemPromptSource?.source === "db-active"
        ? systemPromptSource.version
        : PROMPT_VERSION,
    plan: normalizePlan(parsed),
    rawModelOutput: rawText
  };
}

async function generatePlanForEngagement(engagement) {
  const apiKeyRaw = process.env.CLAUDE_API_KEY || "";
  const hasClaudeKey = Boolean(apiKeyRaw);
  const keyPreview = hasClaudeKey
    ? `${String(apiKeyRaw).slice(0, 10)}...`
    : "NOT SET";
  const plannerModel = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
  const strictPlanner = process.env.CLAUDE_PLANNER_STRICT === "true";
  console.log("[Planner] Attempting plan generation:", {
    hasApiKey: hasClaudeKey,
    keyPreview,
    model: plannerModel,
    engagementId: String(engagement?._id || "")
  });

  const plannerContext = await loadPlannerContext(engagement);
  if (!hasClaudeKey) {
    console.warn("[Planner] No CLAUDE_API_KEY - using template fallback.");
    return {
      source: "template",
      model: "template-planner-v1",
      promptVersion: PROMPT_VERSION,
      fallbackReason: "CLAUDE_API_KEY is not configured",
      plan: appendCveContextToTemplatePlan(
        normalizePlan(templatePlan(engagement)),
        plannerContext.recentCves
      ),
      rawModelOutput: ""
    };
  }

  const claudeResult = await callClaudePlanner(engagement, plannerContext).catch((error) => {
    if (hasClaudeKey && strictPlanner) {
      throw error;
    }
    console.error("[Planner] Claude API FAILED:", error?.message || "Unknown error");
    console.error("[Planner] Error type:", error?.constructor?.name || "Unknown");
    console.error(
      "[Planner] Status:",
      error?.status || error?.statusCode || error?.code || "N/A"
    );
    console.error("[Planner] Full error:", JSON.stringify(error, null, 2));
    console.warn("Claude planner unavailable, using template fallback.");
    return null;
  });

  if (claudeResult) {
    console.log("[Planner] Claude API call succeeded.");
    return {
      ...claudeResult,
      promptVersion: claudeResult.promptVersion || PROMPT_VERSION
    };
  }

  return {
    source: "template",
    model: "template-planner-v1",
    promptVersion: PROMPT_VERSION,
    fallbackReason: "Claude API request failed; template fallback applied",
    plan: appendCveContextToTemplatePlan(
      normalizePlan(templatePlan(engagement)),
      plannerContext.recentCves
    ),
    rawModelOutput: ""
  };
}

module.exports = {
  generatePlanForEngagement,
  PROMPT_VERSION
};
