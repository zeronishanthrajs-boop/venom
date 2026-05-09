const { callGeminiText } = require("./geminiClient");

function normalizeSeverity(value) {
  return String(value || "low").trim().toLowerCase();
}

function toBusinessImpact(finding) {
  const severity = normalizeSeverity(finding?.severity);
  if (severity === "critical") {
    return "An attacker could gain control of sensitive systems or user data.";
  }
  if (severity === "high") {
    return "This could expose user data or allow unauthorized access.";
  }
  if (severity === "medium") {
    return "This weakens your security posture and can be chained with other issues.";
  }
  if (severity === "low") {
    return "This is a hygiene gap that increases future attack surface.";
  }
  return "This is informational but still relevant for security hardening.";
}

function toImmediateAction(finding) {
  const recommendation = String(finding?.recommendation || "").trim();
  if (recommendation) {
    return recommendation.split(".")[0].trim();
  }
  return "Apply vendor security hardening guidance immediately.";
}

function buildHeuristicFounderTranslation(finding) {
  const title = String(finding?.title || "Security issue detected").trim();
  const impact = toBusinessImpact(finding);
  const action = toImmediateAction(finding);
  return `${title}. ${impact} Action now: ${action}.`;
}

function buildHeuristicEngineerTranslation(finding) {
  const title = String(finding?.title || "Security issue detected").trim();
  const category = String(finding?.category || "unknown").trim();
  const cve = String(finding?.cve || "").trim();
  const description = String(finding?.description || "").trim();
  const recommendation = toImmediateAction(finding);
  const cveText = cve ? ` Related CVE: ${cve}.` : "";
  return `${title} (${category}). ${description}${cveText} Remediation: ${recommendation}. Verify by re-running the same probe after patching.`;
}

function buildHeuristicBriefTranslation(finding) {
  const title = String(finding?.title || "Security issue detected").trim();
  const severity = normalizeSeverity(finding?.severity).toUpperCase();
  const impact = toBusinessImpact(finding);
  return `[${severity}] ${title}: ${impact}`;
}

function buildAudiencePrompt(finding, audience) {
  const promptByAudience = {
    founder:
      "Translate this finding for a non-technical startup founder. No jargon. 2-3 sentences. Lead with business impact, end with one concrete action.",
    engineer:
      "Translate this finding for a senior engineer. Include technical detail, likely attack vector, fix guidance, and one verification step.",
    brief:
      "Write a one-sentence executive summary (max 25 words) with urgency and business impact."
  };

  return `${promptByAudience[audience] || promptByAudience.founder}

FINDING JSON:
${JSON.stringify(finding, null, 2)}

Only output plain text.`;
}

function getGeminiModel() {
  return process.env.GEMINI_TRANSLATOR_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash";
}

async function callGeminiTranslation(finding, audience) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || process.env.ENABLE_FINDING_TRANSLATION_AI === "false") {
    return null;
  }

  const response = await callGeminiText({
    apiKey,
    model: getGeminiModel(),
    userPrompt: buildAudiencePrompt(finding, audience),
    maxOutputTokens: 350,
    temperature: 0.2,
    timeoutMs: 15000
  }).catch(() => null);
  const text = response?.text;
  if (!text || typeof text !== "string") {
    return null;
  }
  return text.trim();
}

async function translateFinding(finding, audience = "founder") {
  const normalizedAudience =
    audience === "engineer" || audience === "brief" ? audience : "founder";

  const geminiText = await callGeminiTranslation(finding, normalizedAudience).catch(
    () => null
  );
  if (geminiText) {
    return geminiText;
  }

  if (normalizedAudience === "engineer") {
    return buildHeuristicEngineerTranslation(finding);
  }
  if (normalizedAudience === "brief") {
    return buildHeuristicBriefTranslation(finding);
  }
  return buildHeuristicFounderTranslation(finding);
}

async function translateAllFindings(findings) {
  if (!Array.isArray(findings) || findings.length === 0) {
    return [];
  }

  return Promise.all(
    findings.map(async (finding) => {
      const [founder, engineer, brief] = await Promise.all([
        translateFinding(finding, "founder"),
        translateFinding(finding, "engineer"),
        translateFinding(finding, "brief")
      ]);

      return {
        ...finding,
        translations: {
          founder,
          engineer,
          brief
        }
      };
    })
  );
}

module.exports = {
  translateFinding,
  translateAllFindings,
  __internal: {
    normalizeSeverity,
    toBusinessImpact,
    toImmediateAction,
    buildHeuristicFounderTranslation,
    buildHeuristicEngineerTranslation,
    buildHeuristicBriefTranslation
  }
};
