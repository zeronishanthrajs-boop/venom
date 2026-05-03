import type { VenomSession } from "./session";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_VENOM_API_BASE_URL || "http://localhost:5000";

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
  plannerSource: "claude" | "template";
  model: string;
  summary: string;
  phases: Array<{
    name: string;
    goal: string;
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
  errorMessage?: string;
  createdAt: string;
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
  severity: "high" | "medium" | "low";
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

function buildHeaders(session: VenomSession) {
  return {
    "Content-Type": "application/json",
    "x-api-key": session.apiKey,
    "x-user-id": session.email,
    "x-user-role": session.role
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : "Request failed. Check API settings.";
    throw new Error(message);
  }

  return payload as T;
}

export async function fetchEngagements(
  session: VenomSession
): Promise<Engagement[]> {
  const response = await fetch(`${API_BASE_URL}/api/engagements`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<Engagement[]>(response);
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

  const response = await fetch(`${API_BASE_URL}/api/engagements`, {
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
  const response = await fetch(`${API_BASE_URL}/api/plan`, {
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
  const response = await fetch(
    `${API_BASE_URL}/api/plan/engagement/${engagementId}`,
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
  const response = await fetch(`${API_BASE_URL}/api/execute`, {
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
  const response = await fetch(
    `${API_BASE_URL}/api/execute/engagement/${engagementId}`,
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
  const response = await fetch(
    `${API_BASE_URL}/api/patterns/match?engagementId=${encodeURIComponent(
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
  const response = await fetch(`${API_BASE_URL}/api/learn`, {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({ engagementId })
  });

  return parseResponse<LearnResponse>(response);
}

export async function fetchMetricsOverview(
  session: VenomSession
): Promise<MetricsOverview> {
  const response = await fetch(`${API_BASE_URL}/api/metrics/overview`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<MetricsOverview>(response);
}

export async function fetchAlerts(session: VenomSession): Promise<AlertsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/metrics/alerts`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<AlertsResponse>(response);
}

export async function fetchAllProgress(
  session: VenomSession
): Promise<EngagementProgress[]> {
  const response = await fetch(`${API_BASE_URL}/api/metrics/progress`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<EngagementProgress[]>(response);
}
