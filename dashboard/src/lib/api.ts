import type { VenomSession } from "./session";

export type Engagement = {
  _id: string;
  name: string;
  description: string;
  targetUrl: string;
  targetType: "website" | "api" | "network";
  status: "draft" | "running" | "paused" | "completed" | "failed";
  createdAt: string;
};

export type CreateEngagementInput = {
  name: string;
  description: string;
  targetUrl: string;
  targetType: "website" | "api" | "network";
};

export type Plan = {
  _id: string;
  engagementId: string;
  promptVersion: string;
  plannerSource: "claude" | "claude-api" | "template";
  model: string;
  summary: string;
  phases: Array<{
    name: string;
    goal: string;
    priorityScore?: number;
    riskLevel?: "low" | "medium" | "high" | "critical";
    checks: string[];
    evidence: string[];
    stopConditions: string[];
  }>;
  riskNotes: string[];
  createdAt: string;
};

export type ExecutionJob = {
  _id: string;
  engagementId: string;
  toolId: string;
  targetUrl: string;
  status: "queued" | "running" | "success" | "failed" | "blocked" | "timeout";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  output?: Record<string, unknown>;
  rawOutput?: string;
  findings?: Array<{
    id: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    category: string;
    title: string;
    description: string;
    recommendation: string;
    exploitationPotential?: string;
    cve?: string | null;
    source: string;
    metadata?: Record<string, unknown>;
  }>;
  errorMessage?: string;
  createdAt: string;
};

export type DeleteEngagementResponse = {
  ok: true;
  deletedEngagementId: string;
  plansDeleted: number;
  executionJobsDeleted: number;
};

export type EngagementReport = {
  generatedAt: string;
  engagement: Engagement;
  summary: {
    totalPlans: number;
    totalExecutionJobs: number;
    successfulJobs: number;
    failedJobs: number;
    blockedJobs: number;
    timeoutJobs: number;
    runningJobs: number;
    successRate: number;
  };
  latestPlan: Plan | null;
  latestExecutionJob: ExecutionJob | null;
  patternMatches: PatternMatch[];
  plans: Plan[];
  executionJobs: ExecutionJob[];
};

export type PatternMatch = {
  patternId: string;
  patternName: string;
  targetType: string;
  applicabilityScore: number;
  confidence: number;
  successRate: number;
  recentSuccessRate: number;
  reason: string;
};

export type MatchResponse = {
  engagementId: string;
  targetType: string;
  targetUrl: string;
  rankedPatterns: PatternMatch[];
};

export type LearnResponse = {
  engagementId: string;
  processedJobs: number;
  updatedPatterns: Array<{
    patternId: string;
    name: string;
    successCount: number;
    failureCount: number;
    successRate: number;
    recentSuccessRate: number;
    confidence: number;
  }>;
  message?: string;
};

export type MetricsOverview = {
  generatedAt: string;
  windowDays: number;
  engagementStatus: {
    total: number;
    draft: number;
    running: number;
    paused: number;
    completed: number;
    failed: number;
  };
  jobSummary: {
    totalJobs: number;
    terminalJobs: number;
    runningJobs: number;
    successfulJobs: number;
    failedJobs: number;
    successRate: number;
    avgDurationSeconds: number;
    totalDurationMinutes: number;
    totalCostUsd: number;
    findingsCount: number;
  };
  patternSummary: {
    total: number;
    avgSuccessRate: number;
    avgConfidence: number;
  };
  weekOverWeek: {
    currentWeekSuccessRate: number;
    previousWeekSuccessRate: number;
    delta: number;
  };
  dailyTrend: Array<{
    day: string;
    jobs: number;
    success: number;
    failed: number;
    costUsd: number;
    findings: number;
  }>;
};

export type AlertItem = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  message: string;
};

export type AlertsResponse = {
  generatedAt: string;
  budgetUsd: number;
  alerts: AlertItem[];
};

export type EngagementProgress = {
  engagementId: string;
  status: string;
  currentPhase: string;
  progressPercent: number;
  stats: {
    plansGenerated: number;
    totalJobs: number;
    terminalJobs: number;
    learnedJobs: number;
    findings: number;
  };
};

export type CveSummary = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  withExploit: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
  };
  lastUpdatedAt: string | null;
};

export type CveSyncResponse = {
  ok: true;
  fetched: number;
  normalized: number;
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  syncedAt: string;
};

export type ReportEmailResponse = {
  sent: true;
  to: string;
  fileName: string;
};

export type OwaspCoverageItem = {
  code: string;
  name: string;
  tags: string[];
  findings: Array<{
    id?: string;
    severity?: string;
    category?: string;
    title?: string;
    description?: string;
    recommendation?: string;
    cvssScore?: number;
  }>;
};

export type ComplianceSummary = {
  engagementId: string;
  targetUrl: string;
  totalJobs: number;
  totalFindings: number;
  cvssOverallScore: number;
  cvssSeverity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  owaspCoverage: number;
  owaspBreakdown: Record<string, OwaspCoverageItem>;
  owaspRating: "LOW" | "MODERATE" | "HIGH_RISK";
  remediationPriority: Array<{
    id?: string;
    severity?: string;
    category?: string;
    title?: string;
    description?: string;
    recommendation?: string;
    cvssScore?: number;
  }>;
};

function buildHeaders(session: VenomSession) {
  return {
    "Content-Type": "application/json",
    "x-user-id": session.email,
    "x-user-role": session.role
  };
}

const API_TIMEOUT_MS = 15000;

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(`/api/backend${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Bridge timeout after ${API_TIMEOUT_MS}ms. Backend may be offline or unreachable.`
      );
    }

    if (error instanceof TypeError) {
      throw new Error("Failed to reach dashboard bridge. Check network connectivity.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function throwApiError(response: Response, payload: unknown): never {
  const payloadError =
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
      ? ((payload as { error: string }).error || "").trim()
      : "";

  if (!response.ok) {
    console.error("VENOM bridge request failed", {
      status: response.status,
      payload
    });

    if (response.status === 401) {
      throw new Error(
        "Unauthorized request. Re-login and verify VENOM_BACKEND_API_KEY matches backend VENOM_API_KEY."
      );
    }

    if (response.status === 404) {
      throw new Error(
        "Backend route/service not found (404). Verify VENOM_BACKEND_BASE_URL points to the active Render backend."
      );
    }

    if (response.status === 503) {
      const upstreamMessage = payloadError || "Backend unavailable";
      throw new Error(
        `${upstreamMessage}. Check backend /ready, MongoDB health, and deployment status.`
      );
    }

    if (response.status === 504) {
      throw new Error(
        "Backend timed out (504). Investigate Render service responsiveness and upstream network path."
      );
    }

    const message =
      payloadError || "Request failed. Check API settings.";
    throw new Error(message);
  }
  throw new Error("Unexpected error");
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throwApiError(response, payload);
  }

  return payload as T;
}

export async function fetchEngagements(
  session: VenomSession
): Promise<Engagement[]> {
  const response = await apiFetch("/api/engagements", {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<Engagement[]>(response);
}

export async function deleteEngagement(
  session: VenomSession,
  engagementId: string
): Promise<DeleteEngagementResponse> {
  const response = await apiFetch(`/api/engagements/${engagementId}`, {
    method: "DELETE",
    headers: buildHeaders(session)
  });

  return parseResponse<DeleteEngagementResponse>(response);
}

export async function fetchEngagementReport(
  session: VenomSession,
  engagementId: string
): Promise<EngagementReport> {
  const response = await apiFetch(
    `/api/engagements/${engagementId}/report?format=json`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );

  return parseResponse<EngagementReport>(response);
}

export async function createEngagement(
  session: VenomSession,
  input: CreateEngagementInput
): Promise<Engagement> {
  const parsedUrl = new URL(input.targetUrl);
  const now = new Date();
  const validUntil = new Date(
    now.getTime() + 1000 * 60 * 60 * 24 * 7
  ).toISOString();

  const response = await apiFetch("/api/engagements", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      targetUrl: input.targetUrl,
      targetType: input.targetType,
      scope: {
        allowedDomains: [parsedUrl.hostname],
        restrictedPaths: []
      },
      authorization: {
        engagementId: `eng-${Date.now()}`,
        authorizedBy: session.email,
        validFrom: now.toISOString(),
        validUntil,
        scopeOfWork: "Week 3 dashboard test engagement"
      },
      constraints: {
        toolWhitelist: [],
        noDestructiveOps: true,
        quietMode: false,
        maxConcurrentOps: 1,
        timeoutMinutes: 60
      }
    })
  });

  return parseResponse<Engagement>(response);
}

export async function generatePlan(
  session: VenomSession,
  engagementId: string
): Promise<Plan> {
  const response = await apiFetch("/api/plan", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({ engagementId })
  });

  return parseResponse<Plan>(response);
}

export async function fetchPlansForEngagement(
  session: VenomSession,
  engagementId: string
): Promise<Plan[]> {
  const response = await apiFetch(
    `/api/plan/engagement/${engagementId}`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );

  return parseResponse<Plan[]>(response);
}

export async function runExecutionJob(
  session: VenomSession,
  engagementId: string,
  toolId: string
): Promise<ExecutionJob> {
  const response = await apiFetch("/api/execute", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({
      engagementId,
      toolId
    })
  });

  return parseResponse<ExecutionJob>(response);
}

export async function fetchExecutionJobs(
  session: VenomSession,
  engagementId: string
): Promise<ExecutionJob[]> {
  const response = await apiFetch(
    `/api/execute/engagement/${engagementId}`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );

  return parseResponse<ExecutionJob[]>(response);
}

export async function fetchMatchedPatterns(
  session: VenomSession,
  engagementId: string
): Promise<MatchResponse> {
  const response = await apiFetch(
    `/api/patterns/match?engagementId=${encodeURIComponent(
      engagementId
    )}`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );

  return parseResponse<MatchResponse>(response);
}

export async function runLearning(
  session: VenomSession,
  engagementId: string
): Promise<LearnResponse> {
  const response = await apiFetch("/api/learn", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({ engagementId })
  });

  return parseResponse<LearnResponse>(response);
}

export async function fetchMetricsOverview(
  session: VenomSession
): Promise<MetricsOverview> {
  const response = await apiFetch("/api/metrics/overview", {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<MetricsOverview>(response);
}

export async function fetchAlerts(session: VenomSession): Promise<AlertsResponse> {
  const response = await apiFetch("/api/metrics/alerts", {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<AlertsResponse>(response);
}

export async function fetchAllProgress(
  session: VenomSession
): Promise<EngagementProgress[]> {
  const response = await apiFetch("/api/metrics/progress", {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<EngagementProgress[]>(response);
}

export async function fetchCveSummary(session: VenomSession): Promise<CveSummary> {
  const response = await apiFetch("/api/cves/summary", {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<CveSummary>(response);
}

export async function syncCves(
  session: VenomSession,
  input?: {
    limit?: number;
    sinceDays?: number;
    severity?: string;
    keywordSearch?: string;
  }
): Promise<CveSyncResponse> {
  const response = await apiFetch("/api/cves/sync", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify(input || {})
  });

  return parseResponse<CveSyncResponse>(response);
}

export async function fetchComplianceSummary(
  session: VenomSession,
  engagementId: string
): Promise<ComplianceSummary> {
  const response = await apiFetch(`/api/compliance/${encodeURIComponent(engagementId)}`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<ComplianceSummary>(response);
}

export async function emailBackendReport(
  session: VenomSession,
  engagementId: string,
  recipientEmail: string
): Promise<ReportEmailResponse> {
  const response = await apiFetch(
    `/api/reports/${encodeURIComponent(engagementId)}/email`,
    {
      method: "POST",
      headers: buildHeaders(session),
      body: JSON.stringify({ recipientEmail })
    }
  );

  return parseResponse<ReportEmailResponse>(response);
}

export async function downloadBackendPdfReport(
  session: VenomSession,
  engagementId: string
): Promise<Blob> {
  const response = await apiFetch(
    `/api/reports/${encodeURIComponent(engagementId)}/pdf`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throwApiError(response, payload);
  }

  return response.blob();
}
