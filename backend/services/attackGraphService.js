const Pattern = require("../models/Pattern");
const { logger } = require("../config/logger");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeToolName(toolName) {
  return String(toolName || "").trim().toLowerCase();
}

function normalizeCondition(condition) {
  if (typeof condition === "string") {
    return condition.trim();
  }
  if (condition && typeof condition.type === "string") {
    return condition.type.trim();
  }
  return "";
}

function normalizeConditions(input = []) {
  const values = Array.isArray(input) ? input : [];
  const unique = new Set();
  for (const item of values) {
    const normalized = normalizeCondition(item);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function severityToConfidence(severity) {
  const normalized = String(severity || "").trim().toLowerCase();
  if (normalized === "critical") {
    return 0.9;
  }
  if (normalized === "high") {
    return 0.82;
  }
  if (normalized === "medium") {
    return 0.74;
  }
  if (normalized === "low") {
    return 0.66;
  }
  if (normalized === "info") {
    return 0.6;
  }
  return 0.65;
}

function findTextSignal(findingsItem = {}) {
  const tags = Array.isArray(findingsItem.tags)
    ? findingsItem.tags.map((tag) => String(tag || ""))
    : [];
  return [
    findingsItem.title,
    findingsItem.description,
    findingsItem.category,
    findingsItem.recommendation,
    tags.join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function conditionTargetType(conditionType) {
  if (conditionType === "IDS-Present") {
    return "network";
  }
  if (conditionType === "SQL-Injectable" || conditionType === "JWT-Auth") {
    return "api";
  }
  return "website";
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function defaultToolsForCondition(conditionType) {
  const map = {
    "WAF-Detected": ["sqlmap_detect", "nuclei_scan"],
    "JWT-Auth": ["sqlmap_detect", "http_headers_probe"],
    "SQL-Injectable": ["sqlmap_detect", "nuclei_scan"],
    "OAuth-Endpoint": ["http_headers_probe", "nuclei_scan"],
    "CORS-Misconfigured": ["http_headers_probe", "nikto_scan"],
    "IDS-Present": ["nmap_tcp_scan", "nuclei_scan"]
  };
  return map[conditionType] || ["nuclei_scan"];
}

function getSuggestedParams(toolName, detectedConditions) {
  const normalizedTool = normalizeToolName(toolName);
  const normalizedConditions = normalizeConditions(detectedConditions);

  const paramMap = {
    sqlmap_detect: {
      "WAF-Detected": { tamper: "space2comment", technique: "BEUSTQ" },
      "JWT-Auth": { authToken: true, header: "Authorization" },
      "SQL-Injectable": { level: 3, risk: 2 }
    },
    nuclei_scan: {
      "WAF-Detected": { rateLimit: 10, timeout: 30 },
      "OAuth-Endpoint": { templates: "oauth,misconfiguration" },
      "CORS-Misconfigured": { templates: "cors,misconfiguration" }
    },
    nmap_tcp_scan: {
      "IDS-Present": { scanDelay: "5s", dataLength: 300 }
    },
    http_headers_probe: {
      "JWT-Auth": { includeAuthHeaders: true },
      "CORS-Misconfigured": { includeOriginMatrix: true }
    }
  };

  const params = {};
  for (const condition of normalizedConditions) {
    const adjustment = paramMap[normalizedTool]?.[condition];
    if (adjustment && typeof adjustment === "object") {
      Object.assign(params, adjustment);
    }
  }

  return params;
}

function buildDefaultNextTools(toolName, conditionType, successRate = 0.5) {
  const preferredTool = normalizeToolName(toolName);
  const orderedToolNames = [
    preferredTool,
    ...defaultToolsForCondition(conditionType).map(normalizeToolName)
  ].filter(Boolean);

  const uniqueTools = [];
  const seen = new Set();
  for (const tool of orderedToolNames) {
    if (seen.has(tool)) {
      continue;
    }
    seen.add(tool);
    uniqueTools.push(tool);
  }

  return uniqueTools.slice(0, 3).map((tool, index) => {
    const expectedSuccess = clamp(successRate - index * 0.05, 0.1, 0.98);
    return {
      tool,
      paramAdjustment: getSuggestedParams(tool, [conditionType]),
      expectedSuccess: Number(expectedSuccess.toFixed(4))
    };
  });
}

function extractConditions(findings = []) {
  const list = Array.isArray(findings) ? findings : [];
  const buckets = new Map();

  for (const finding of list) {
    const signal = findTextSignal(finding);
    const confidence = severityToConfidence(finding?.severity);
    const matches = [];

    if (/waf|modsecurity|cloudflare|imperva|akamai/.test(signal)) {
      matches.push("WAF-Detected");
    }
    if (/jwt|json web token|bearer/.test(signal)) {
      matches.push("JWT-Auth");
    }
    if (/sql|sqli|sql injection/.test(signal)) {
      matches.push("SQL-Injectable");
    }
    if (/oauth|openid|oidc|token endpoint/.test(signal)) {
      matches.push("OAuth-Endpoint");
    }
    if (/cors|access-control-allow-origin/.test(signal)) {
      matches.push("CORS-Misconfigured");
    }
    if (/ids|ips|intrusion detection/.test(signal)) {
      matches.push("IDS-Present");
    }

    for (const type of matches) {
      const current = buckets.get(type);
      if (!current || confidence > current.confidence) {
        buckets.set(type, {
          type,
          severity: String(finding?.severity || "").toLowerCase(),
          confidence
        });
      }
    }
  }

  return [...buckets.values()];
}

function updateNextTools(conditionEntry, toolName, conditionType, success) {
  if (!Array.isArray(conditionEntry.nextTools)) {
    conditionEntry.nextTools = [];
  }

  if (conditionEntry.nextTools.length === 0) {
    conditionEntry.nextTools = buildDefaultNextTools(
      toolName,
      conditionType,
      success ? 0.75 : 0.35
    );
    return;
  }

  const normalizedTool = normalizeToolName(toolName);
  if (!normalizedTool) {
    return;
  }

  const existing = conditionEntry.nextTools.find(
    (item) => normalizeToolName(item.tool) === normalizedTool
  );
  const observed = success ? 1 : 0;

  if (!existing) {
    conditionEntry.nextTools.push({
      tool: normalizedTool,
      paramAdjustment: getSuggestedParams(normalizedTool, [conditionType]),
      expectedSuccess: Number(
        clamp(
          conditionEntry.successRate * 0.75 + observed * 0.25,
          0.1,
          0.98
        ).toFixed(4)
      )
    });
    return;
  }

  const previous = Number(existing.expectedSuccess || conditionEntry.successRate || 0.5);
  existing.expectedSuccess = Number(
    clamp(previous * 0.8 + observed * 0.2, 0.05, 0.99).toFixed(4)
  );
  existing.paramAdjustment = {
    ...(existing.paramAdjustment || {}),
    ...getSuggestedParams(normalizedTool, [conditionType])
  };
}

async function recordToolOutcome(engagementId, toolName, findings, success) {
  try {
    const detectedConditions = extractConditions(findings);
    if (detectedConditions.length === 0) {
      return {
        engagementId,
        toolName,
        learnedConditions: 0
      };
    }

    const normalizedTool = normalizeToolName(toolName);
    let learnedConditions = 0;

    for (const condition of detectedConditions) {
      let pattern = await Pattern.findOne({
        "attackGraph.conditions.finding": condition.type
      });

      if (!pattern) {
        pattern = await Pattern.create({
          name: `learned_condition_${slugify(condition.type)}`,
          description: `Auto-learned attack path signal for ${condition.type}.`,
          targetType: conditionTargetType(condition.type),
          source: "execution-telemetry",
          tags: [slugify(condition.type), "learning", "attack-graph"].filter(Boolean),
          attackGraph: {
            conditions: [
              {
                finding: condition.type,
                confidence: Number(clamp(condition.confidence, 0.3, 0.95).toFixed(4)),
                learnedFrom: 1,
                successRate: success ? 1 : 0,
                nextTools: buildDefaultNextTools(
                  normalizedTool,
                  condition.type,
                  success ? 0.75 : 0.35
                )
              }
            ],
            lastUpdated: new Date(),
            engagementsSeen: 1
          }
        });
      } else {
        if (!pattern.attackGraph || typeof pattern.attackGraph !== "object") {
          pattern.attackGraph = {
            conditions: [],
            lastUpdated: null,
            engagementsSeen: 0
          };
        }
        if (!Array.isArray(pattern.attackGraph.conditions)) {
          pattern.attackGraph.conditions = [];
        }

        let conditionEntry = pattern.attackGraph.conditions.find(
          (item) => item.finding === condition.type
        );

        if (!conditionEntry) {
          conditionEntry = {
            finding: condition.type,
            confidence: Number(clamp(condition.confidence, 0.3, 0.95).toFixed(4)),
            learnedFrom: 0,
            successRate: 0,
            nextTools: []
          };
          pattern.attackGraph.conditions.push(conditionEntry);
        }

        const previousCount = Number(conditionEntry.learnedFrom || 0);
        const nextCount = previousCount + 1;
        const previousRate = Number(conditionEntry.successRate || 0);
        const observed = success ? 1 : 0;
        const nextRate = (previousRate * previousCount + observed) / nextCount;
        conditionEntry.learnedFrom = nextCount;
        conditionEntry.successRate = Number(clamp(nextRate, 0, 1).toFixed(4));
        const blendedConfidence =
          Number(conditionEntry.confidence || 0.55) * 0.7 +
          Number(condition.confidence || 0.6) * 0.2 +
          (success ? 0.1 : -0.04);
        conditionEntry.confidence = Number(clamp(blendedConfidence, 0.2, 0.97).toFixed(4));
        updateNextTools(conditionEntry, normalizedTool, condition.type, success);

        pattern.attackGraph.lastUpdated = new Date();
        pattern.attackGraph.engagementsSeen = Number(
          pattern.attackGraph.engagementsSeen || 0
        ) + 1;
        await pattern.save();
      }

      learnedConditions += 1;
      logger.info(
        {
          engagementId,
          toolName: normalizedTool,
          condition: condition.type,
          success
        },
        "Attack graph condition learned"
      );
    }

    return {
      engagementId,
      toolName: normalizedTool,
      learnedConditions
    };
  } catch (error) {
    logger.error(
      {
        error: error?.message || String(error),
        engagementId,
        toolName
      },
      "Failed to record attack graph outcome"
    );
    return {
      engagementId,
      toolName,
      learnedConditions: 0,
      error: error?.message || "unknown_error"
    };
  }
}

async function getRecommendedTools(detectedConditions = []) {
  const conditions = normalizeConditions(detectedConditions);
  const recommendations = {};

  for (const condition of conditions) {
    const pattern = await Pattern.findOne({
      "attackGraph.conditions.finding": condition
    }).lean();

    if (!pattern || !Array.isArray(pattern.attackGraph?.conditions)) {
      continue;
    }

    const conditionEntry = pattern.attackGraph.conditions.find(
      (item) => item.finding === condition
    );
    if (!conditionEntry) {
      continue;
    }

    let nextTools = Array.isArray(conditionEntry.nextTools)
      ? [...conditionEntry.nextTools]
      : [];

    if (nextTools.length === 0) {
      nextTools = buildDefaultNextTools(
        "",
        condition,
        Number(conditionEntry.successRate || 0.5)
      );
    }

    recommendations[condition] = nextTools
      .map((item) => ({
        tool: normalizeToolName(item.tool),
        paramAdjustment:
          item.paramAdjustment && typeof item.paramAdjustment === "object"
            ? item.paramAdjustment
            : {},
        expectedSuccess: Number(
          clamp(Number(item.expectedSuccess || 0), 0, 1).toFixed(4)
        )
      }))
      .filter((item) => Boolean(item.tool))
      .sort((left, right) => right.expectedSuccess - left.expectedSuccess)
      .slice(0, 3);
  }

  return recommendations;
}

module.exports = {
  recordToolOutcome,
  extractConditions,
  getRecommendedTools,
  getSuggestedParams
};
