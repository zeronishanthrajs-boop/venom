const Engagement = require("../models/Engagement");
const ExecutionJob = require("../models/ExecutionJob");
const DecisionBrief = require("../models/DecisionBrief");
const { callGeminiText } = require("./geminiClient");

function normalizeSeverity(value) {
  return String(value || "low").trim().toLowerCase();
}

function toSeverityScore(severity) {
  const normalized = normalizeSeverity(severity);
  if (normalized === "critical") {
    return 9.4;
  }
  if (normalized === "high") {
    return 8;
  }
  if (normalized === "medium") {
    return 5.5;
  }
  if (normalized === "low") {
    return 3.2;
  }
  return 1.2;
}

function toCvssScore(finding) {
  const direct = Number(finding?.cvssScore);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const metadataCvss = Number(finding?.metadata?.cvssScore);
  if (Number.isFinite(metadataCvss) && metadataCvss > 0) {
    return metadataCvss;
  }
  return toSeverityScore(finding?.severity);
}

function hasDataRisk(finding) {
  const bag = [
    ...(Array.isArray(finding?.tags) ? finding.tags : []),
    String(finding?.category || ""),
    String(finding?.title || ""),
    String(finding?.description || "")
  ]
    .join(" ")
    .toLowerCase();

  return /sqli|idor|data|credential|auth|session|xss|csrf|disclosure/.test(bag);
}

function isPublicFacing(engagement) {
  const targetType = String(engagement?.targetType || "").toLowerCase();
  if (targetType === "website" || targetType === "api") {
    return true;
  }
  return /^https?:\/\//i.test(String(engagement?.targetUrl || ""));
}

function requiresAuth(finding) {
  const bag = [
    ...(Array.isArray(finding?.tags) ? finding.tags : []),
    String(finding?.category || ""),
    String(finding?.title || "")
  ]
    .join(" ")
    .toLowerCase();
  return /auth|credential|login|session/.test(bag);
}

function hasKnownExploit(finding) {
  return Boolean(finding?.exploitAvailable || finding?.cve);
}

function computeContextualSeverity(finding, engagement) {
  let score = toCvssScore(finding) * 10;

  if (isPublicFacing(engagement)) {
    score *= 1.25;
  }
  if (hasKnownExploit(finding)) {
    score *= 1.3;
  }
  if (hasDataRisk(finding)) {
    score *= 1.2;
  }
  if (requiresAuth(finding)) {
    score *= 0.85;
  }

  return Math.max(1, Math.min(100, Math.round(score)));
}

function classifyRiskLevel(score) {
  if (score >= 85) {
    return "critical";
  }
  if (score >= 70) {
    return "high";
  }
  if (score >= 45) {
    return "medium";
  }
  if (score > 0) {
    return "low";
  }
  return "clean";
}

function estimateFixDifficulty(finding) {
  const bag = [
    String(finding?.title || ""),
    String(finding?.description || ""),
    String(finding?.category || "")
  ]
    .join(" ")
    .toLowerCase();

  if (/rce|deserialization|sqli|injection|auth bypass/.test(bag)) {
    return "hard";
  }
  if (/xss|csrf|misconfig|headers|tls|exposure/.test(bag)) {
    return "medium";
  }
  return "easy";
}

function estimateFixTime(difficulty) {
  if (difficulty === "hard") {
    return "1-3 days";
  }
  if (difficulty === "medium") {
    return "2-6 hours";
  }
  return "30-90 minutes";
}

function firstSentence(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  const split = text.split(".");
  return split[0]?.trim() || text;
}

function findingKey(finding) {
  return `${String(finding?.title || "").trim().toLowerCase()}|${String(
    finding?.category || ""
  )
    .trim()
    .toLowerCase()}|${String(finding?.cve || "")
    .trim()
    .toLowerCase()}`;
}

function buildHeuristicDecision(scoredFindings) {
  const ignoreList = scoredFindings
    .filter(
      (finding) =>
        finding.contextualSeverity <= 25 &&
        !hasKnownExploit(finding) &&
        ["low", "info"].includes(normalizeSeverity(finding.severity))
    )
    .map((finding) => ({
      title: finding.title || "Untitled finding",
      reason: "Low contextual impact and no known active exploit signal."
    }));

  const ignoreKeySet = new Set(ignoreList.map((item) => item.title.toLowerCase()));
  const actionable = scoredFindings.filter(
    (finding) => !ignoreKeySet.has(String(finding.title || "").toLowerCase())
  );

  const topThree = actionable.slice(0, 3).map((finding, index) => {
    const difficulty = estimateFixDifficulty(finding);
    const impact =
      firstSentence(finding.exploitationPotential) ||
      firstSentence(finding.description) ||
      "Potential business-impacting security incident.";
    const immediateAction =
      firstSentence(finding.recommendation) || "Assign owner and patch this issue now";

    return {
      rank: index + 1,
      title: finding.title || "Untitled finding",
      whyThisFirst: `High contextual severity (${finding.contextualSeverity}/100) and public exposure risk.`,
      whatCouldHappen: impact,
      fixDifficulty: difficulty,
      estimatedFixTime: estimateFixTime(difficulty),
      immediateAction
    };
  });

  const riskScore =
    actionable.length > 0
      ? Math.round(
          actionable
            .slice(0, 5)
            .reduce((sum, finding) => sum + finding.contextualSeverity, 0) /
            Math.min(actionable.length, 5)
        )
      : 0;

  const riskLevel =
    actionable.length === 0 ? "clean" : classifyRiskLevel(riskScore);

  return {
    topThreeRisks: topThree,
    ignoreReasons: ignoreList.slice(0, 20),
    overallRiskSentence:
      actionable.length === 0
        ? "No actionable findings are currently open for this engagement."
        : `Top ${Math.min(3, actionable.length)} issues create the majority of risk. Prioritize immediate remediation before new feature rollout.`,
    riskLevel,
    shouldPageOnCall: riskLevel === "critical" || riskLevel === "high",
    riskScore,
    actionableCount: actionable.length,
    ignoredCount: ignoreList.length
  };
}

function extractJsonObject(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return null;
  }

  const cleaned = normalized.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function tryGeminiDecisionBrief(engagement, scoredFindings, ignoreList) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || process.env.ENABLE_DECISION_BRIEF_AI === "false") {
    return null;
  }

  const model = process.env.GEMINI_DECISION_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const prompt = `You are VENOM decision intelligence. Produce an actionable risk brief in JSON.

Target: ${engagement.targetUrl}
TargetType: ${engagement.targetType}
BusinessContext: ${engagement.description || "n/a"}

Actionable findings:
${JSON.stringify(scoredFindings.slice(0, 20), null, 2)}

Ignore candidates:
${JSON.stringify(ignoreList.slice(0, 15), null, 2)}

Return STRICT JSON:
{
  "topThreeRisks":[{"rank":1,"title":"","whyThisFirst":"","whatCouldHappen":"","fixDifficulty":"easy|medium|hard","estimatedFixTime":"","immediateAction":""}],
  "ignoreReasons":[{"title":"","reason":""}],
  "overallRiskSentence":"",
  "riskLevel":"critical|high|medium|low|clean",
  "shouldPageOnCall": true
}`;

  const response = await callGeminiText({
    apiKey,
    model,
    userPrompt: prompt,
    temperature: 0.2,
    maxOutputTokens: 1800,
    timeoutMs: 25000,
    responseMimeType: "application/json"
  }).catch(() => null);
  const text = response?.text;
  if (!text) {
    return null;
  }
  return extractJsonObject(text);
}

function flattenFindingsFromJobs(jobs) {
  const dedup = new Map();
  for (const job of jobs) {
    const findings = Array.isArray(job.findings)
      ? job.findings
      : Array.isArray(job.output?.findings)
        ? job.output.findings
        : [];
    for (const finding of findings) {
      const key = findingKey(finding);
      if (!key || dedup.has(key)) {
        continue;
      }
      dedup.set(key, finding);
    }
  }
  return [...dedup.values()];
}

async function generateDecisionBrief(engagementId) {
  const engagement = await Engagement.findById(engagementId).lean();
  if (!engagement) {
    const error = new Error("Engagement not found");
    error.code = "ENGAGEMENT_NOT_FOUND";
    throw error;
  }

  const jobs = await ExecutionJob.find({
    engagementId,
    status: { $in: ["success", "failed", "blocked", "timeout"] }
  })
    .sort({ createdAt: -1 })
    .limit(150)
    .lean();

  const findings = flattenFindingsFromJobs(jobs);
  if (findings.length === 0) {
    const generatedAt = new Date();
    const emptyBrief = await DecisionBrief.findOneAndUpdate(
      { engagementId },
      {
        $set: {
          topRisks: [],
          ignoreList: [],
          overallRiskSentence: "No findings yet. Run scans first.",
          riskLevel: "clean",
          shouldPageOnCall: false,
          riskScore: 0,
          totalFindings: 0,
          actionableFindings: 0,
          ignoredFindings: 0,
          source: "heuristic",
          generatedAt
        }
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    ).lean();
    return emptyBrief;
  }

  const scored = findings
    .map((finding) => ({
      ...finding,
      contextualSeverity: computeContextualSeverity(finding, engagement),
      rawCvss: toCvssScore(finding)
    }))
    .sort((left, right) => right.contextualSeverity - left.contextualSeverity);

  const heuristic = buildHeuristicDecision(scored);
  const gemini = await tryGeminiDecisionBrief(
    engagement,
    scored,
    heuristic.ignoreReasons
  ).catch(() => null);

  const topRisks = Array.isArray(gemini?.topThreeRisks)
    ? gemini.topThreeRisks.slice(0, 3)
    : heuristic.topThreeRisks;
  const ignoreList = Array.isArray(gemini?.ignoreReasons)
    ? gemini.ignoreReasons
    : heuristic.ignoreReasons;
  const riskLevel = ["critical", "high", "medium", "low", "clean"].includes(
    String(gemini?.riskLevel || "").toLowerCase()
  )
    ? String(gemini.riskLevel).toLowerCase()
    : heuristic.riskLevel;
  const overallRiskSentence =
    String(gemini?.overallRiskSentence || "").trim() ||
    heuristic.overallRiskSentence;

  const generatedAt = new Date();
  const brief = await DecisionBrief.findOneAndUpdate(
    { engagementId },
    {
      $set: {
        topRisks,
        ignoreList,
        overallRiskSentence,
        riskLevel,
        shouldPageOnCall: Boolean(gemini?.shouldPageOnCall ?? heuristic.shouldPageOnCall),
        riskScore: heuristic.riskScore,
        totalFindings: findings.length,
        actionableFindings: heuristic.actionableCount,
        ignoredFindings: heuristic.ignoredCount,
        source: gemini ? "gemini" : "heuristic",
        generatedAt
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  ).lean();

  return brief;
}

async function getLatestDecisionBrief(engagementId) {
  const latest = await DecisionBrief.findOne({ engagementId })
    .sort({ generatedAt: -1, createdAt: -1 })
    .lean();
  return latest || null;
}

module.exports = {
  computeContextualSeverity,
  generateDecisionBrief,
  getLatestDecisionBrief,
  __internal: {
    normalizeSeverity,
    toCvssScore,
    classifyRiskLevel,
    estimateFixDifficulty,
    buildHeuristicDecision,
    extractJsonObject,
    flattenFindingsFromJobs
  }
};
