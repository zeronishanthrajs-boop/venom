const fs = require("node:fs/promises");
const path = require("node:path");

const PROMPT_VERSION = "planning_v1_2026_05_02";
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

async function loadSystemPrompt() {
  const promptPath = path.join(
    __dirname,
    "..",
    "prompts",
    "planning-agent-v1.txt"
  );
  return fs.readFile(promptPath, "utf8");
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

async function callClaudePlanner(engagement) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest";
  const systemPrompt = await loadSystemPrompt();
  const userPayload = buildUserPayload(engagement);

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
      system: systemPrompt,
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
  const jsonText = stripCodeFences(rawText);
  const parsed = JSON.parse(jsonText);

  return {
    source: "claude",
    model,
    plan: normalizePlan(parsed),
    rawModelOutput: rawText
  };
}

async function generatePlanForEngagement(engagement) {
  const claudeResult = await callClaudePlanner(engagement).catch((error) => {
    console.warn("Claude planner unavailable, using template:", error.message);
    return null;
  });

  if (claudeResult) {
    return {
      ...claudeResult,
      promptVersion: PROMPT_VERSION
    };
  }

  return {
    source: "template",
    model: "template-planner-v1",
    promptVersion: PROMPT_VERSION,
    plan: normalizePlan(templatePlan(engagement)),
    rawModelOutput: ""
  };
}

module.exports = {
  generatePlanForEngagement,
  PROMPT_VERSION
};
