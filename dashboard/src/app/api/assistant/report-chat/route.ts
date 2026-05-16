import { NextRequest, NextResponse } from "next/server";

import {
  getAuthRequestContext,
  refreshAuthTokens,
  verifyAuthToken
} from "@/lib/auth";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  REFRESH_COOKIE_NAME
} from "@/lib/authConstants";

export const runtime = "nodejs";

type RiskItem = {
  title?: string;
  immediateAction?: string;
  whyThisFirst?: string;
};

type ChatRequestBody = {
  engagementId?: string;
  question?: string;
  conversation?: Array<{ role?: string; content?: string }>;
  reportSnapshot?: {
    status?: string;
    findingsCount?: number;
    topFindings?: Array<{ severity?: string; title?: string; recommendation?: string }>;
    topRisks?: RiskItem[];
  };
};

type ReportPayload = {
  engagement?: {
    targetUrl?: string;
    status?: string;
  };
  summary?: {
    totalExecutionJobs?: number;
    successfulJobs?: number;
    failedJobs?: number;
    blockedJobs?: number;
    timeoutJobs?: number;
  };
  patternMatches?: Array<{
    patternName?: string;
    applicabilityScore?: number;
    confidence?: number;
  }>;
  executionJobs?: Array<{
    findings?: Array<{
      title?: string;
      severity?: string;
      description?: string;
      recommendation?: string;
      source?: string;
    }>;
  }>;
};

type DecisionBriefPayload = {
  topRisks?: RiskItem[];
  overallRiskSentence?: string;
  riskLevel?: string;
};

function getBackendBaseUrl() {
  const configured =
    process.env.VENOM_BACKEND_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_VENOM_API_BASE_URL?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("VENOM_BACKEND_BASE_URL is required in production.");
  }

  return "http://localhost:5000";
}

function getBackendApiKey() {
  return (
    process.env.VENOM_BACKEND_API_KEY?.trim() ||
    process.env.VENOM_API_KEY?.trim() ||
    ""
  );
}

function extractTopFindings(report: ReportPayload) {
  const findings: Array<{
    title: string;
    severity: string;
    description: string;
    recommendation: string;
    source: string;
  }> = [];

  for (const job of report.executionJobs || []) {
    for (const finding of job.findings || []) {
      findings.push({
        title: String(finding.title || "Untitled finding"),
        severity: String(finding.severity || "low").toLowerCase(),
        description: String(finding.description || ""),
        recommendation: String(finding.recommendation || ""),
        source: String(finding.source || "unknown_tool")
      });
    }
  }

  findings.sort((left, right) => {
    const order = ["critical", "high", "medium", "low", "info"];
    return order.indexOf(left.severity) - order.indexOf(right.severity);
  });

  return findings.slice(0, 12);
}

function buildFallbackAnswer(
  question: string,
  report: ReportPayload,
  brief: DecisionBriefPayload | null,
  snapshot?: ChatRequestBody["reportSnapshot"]
) {
  const normalized = String(question || "").toLowerCase();
  const summary = snapshot || {};
  const findingsCount = Number(summary.findingsCount || 0);
  const topFindings = Array.isArray(summary.topFindings) ? summary.topFindings : [];
  const topRisks = Array.isArray(summary.topRisks)
    ? summary.topRisks
    : Array.isArray(brief?.topRisks)
      ? brief.topRisks
      : [];

  if (normalized.includes("critical") || normalized.includes("urgent")) {
    const criticalTitles = topFindings
      .filter((item) => String(item.severity || "").toLowerCase() === "critical")
      .map((item) => String(item.title || "critical finding"));

    if (criticalTitles.length === 0) {
      return "No critical findings are currently visible. Prioritize high-severity items while scans finalize.";
    }

    return `Critical focus: ${criticalTitles.slice(0, 3).join("; ")}. Start containment, patching, and retest in that order.`;
  }

  if (normalized.includes("next") || normalized.includes("what should") || normalized.includes("priorit")) {
    if (topRisks.length > 0) {
      return `Recommended next actions: ${topRisks
        .slice(0, 3)
        .map((item, index) => `${index + 1}) ${item.immediateAction || item.title || "Address top risk"}`)
        .join(" ")}`;
    }

    const recs = topFindings
      .map((item) => String(item.recommendation || ""))
      .filter(Boolean)
      .slice(0, 3);
    if (recs.length > 0) {
      return `Immediate next steps: ${recs.map((item, index) => `${index + 1}) ${item}`).join(" ")}`;
    }

    return "Scan is still building. Once complete, prioritize exploitable public-facing findings first.";
  }

  if (normalized.includes("status") || normalized.includes("progress")) {
    const status = report.engagement?.status || snapshot?.status || "unknown";
    return `Current status: ${status}. Findings observed so far: ${findingsCount}.`;
  }

  if (normalized.includes("owasp") || normalized.includes("compliance")) {
    return "Use the Compliance & Evidence section for OWASP/CVSS prioritization. Fix highest CVSS issues with public exposure first.";
  }

  const riskSentence = brief?.overallRiskSentence || "Top issues should be remediated before broader rollout.";
  return `${riskSentence} Current findings tracked: ${findingsCount}. Ask about critical findings, root cause, or remediation order for deeper guidance.`;
}

function buildPrompt(
  question: string,
  report: ReportPayload,
  brief: DecisionBriefPayload | null,
  conversation: Array<{ role?: string; content?: string }>,
  snapshot?: ChatRequestBody["reportSnapshot"]
) {
  const topFindings = extractTopFindings(report);
  const topRisks = Array.isArray(snapshot?.topRisks)
    ? snapshot?.topRisks
    : Array.isArray(brief?.topRisks)
      ? brief?.topRisks
      : [];

  const history = conversation
    .slice(-6)
    .map((item) => `${item.role || "user"}: ${String(item.content || "")}`)
    .join("\n");

  return `You are VENOM report assistant. Answer clearly, professionally, and with concrete remediation guidance.

Target: ${report.engagement?.targetUrl || "unknown"}
Scan status: ${report.engagement?.status || snapshot?.status || "unknown"}
Jobs run: ${report.summary?.totalExecutionJobs || 0}
Successful jobs: ${report.summary?.successfulJobs || 0}
Failed jobs: ${report.summary?.failedJobs || 0}

Top findings:
${topFindings
  .slice(0, 10)
  .map(
    (item, index) =>
      `${index + 1}. [${item.severity}] ${item.title} | source=${item.source} | recommendation=${item.recommendation || "n/a"}`
  )
  .join("\n")}

Top risk priorities:
${topRisks
  .slice(0, 5)
  .map(
    (item, index) =>
      `${index + 1}. ${item.title || "Risk"} | action=${item.immediateAction || "Review and remediate"}`
  )
  .join("\n")}

Prior context:
${history || "(none)"}

User question: ${question}

Rules:
1) Keep answer concise (max 180 words).
2) Be factual and grounded in provided report data.
3) If data is still incomplete, explicitly say scan is in progress.
4) Include prioritized next action when possible.`;
}

async function callGemini(prompt: string) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return null;
  }

  const model = String(
    process.env.GEMINI_DECISION_MODEL || process.env.GEMINI_MODEL || "gemini-2.0-flash"
  )
    .trim()
    .replace(/^models\//i, "");
  const baseUrl = String(
    process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/g, "");

  const response = await fetch(
    `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 450
        }
      }),
      signal:
        typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(15000)
          : undefined
    }
  ).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      }
    | null;

  if (!payload?.candidates?.length) {
    return null;
  }

  const chunks: string[] = [];
  for (const candidate of payload.candidates) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim());
      }
    }
  }

  const answer = chunks.join("\n").trim();
  return answer || null;
}

async function fetchBackendJson<T>(
  path: string,
  session: { email: string; role: string }
): Promise<T> {
  const backendApiKey = getBackendApiKey();
  if (!backendApiKey) {
    throw new Error("Dashboard backend bridge API key missing");
  }

  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    method: "GET",
    headers: {
      "x-api-key": backendApiKey,
      "x-user-id": session.email,
      "x-user-role": session.role,
      "content-type": "application/json"
    },
    cache: "no-store",
    signal:
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(15000)
        : undefined
  });

  if (!response.ok) {
    throw new Error(`Backend request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export async function POST(request: NextRequest) {
  const requestContext = getAuthRequestContext(request.headers);
  const accessToken = request.cookies.get(AUTH_COOKIE_NAME)?.value || null;
  const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME)?.value || null;

  let session = await verifyAuthToken(accessToken, requestContext);
  let refreshed: Awaited<ReturnType<typeof refreshAuthTokens>> = null;

  if (!session) {
    refreshed = await refreshAuthTokens(refreshToken, requestContext);
    session = refreshed?.session || null;
  }

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as ChatRequestBody;
  const engagementId = String(payload.engagementId || "").trim();
  const question = String(payload.question || "").trim();
  if (!engagementId || !question) {
    return NextResponse.json(
      { error: "engagementId and question are required" },
      { status: 400 }
    );
  }

  let report: ReportPayload | null = null;
  let brief: DecisionBriefPayload | null = null;

  try {
    report = await fetchBackendJson<ReportPayload>(
      `/api/engagements/${encodeURIComponent(engagementId)}/report?format=json`,
      session
    );
  } catch {
    report = null;
  }

  try {
    brief = await fetchBackendJson<DecisionBriefPayload | null>(
      `/api/decisions/${encodeURIComponent(engagementId)}/brief`,
      session
    );
  } catch {
    brief = null;
  }

  const safeReport = report || {
    engagement: {
      status: payload.reportSnapshot?.status || "unknown"
    },
    summary: {
      totalExecutionJobs: 0,
      successfulJobs: 0,
      failedJobs: 0,
      blockedJobs: 0,
      timeoutJobs: 0
    },
    executionJobs: []
  };

  const prompt = buildPrompt(
    question,
    safeReport,
    brief,
    Array.isArray(payload.conversation) ? payload.conversation : [],
    payload.reportSnapshot
  );

  const geminiAnswer = await callGemini(prompt);
  const answer =
    geminiAnswer ||
    buildFallbackAnswer(question, safeReport, brief, payload.reportSnapshot);

  const response = NextResponse.json({
    answer,
    source: geminiAnswer ? "gemini" : "heuristic"
  });

  if (refreshed) {
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: refreshed.accessToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS
    });
    response.cookies.set({
      name: REFRESH_COOKIE_NAME,
      value: refreshed.refreshToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS
    });
  }

  return response;
}
