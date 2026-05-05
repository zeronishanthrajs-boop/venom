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
  scanProfile?: "startup";
  startupConcern?: string;
  ownershipAssertion?: string;
};

export type Plan = {
  _id: string;
  engagementId: string;
  promptVersion: string;
  plannerSource: "claude" | "claude-api" | "template";
  model: string;
  fallbackReason?: string;
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
    tags?: string[];
    cvssScore?: number | null;
    exploitAvailable?: boolean;
    translations?: {
      founder?: string;
      engineer?: string;
      brief?: string;
    };
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
  evidenceDeleted?: number;
};

export type ChainExecutionResult = {
  step: number;
  toolId: string;
  name: string;
  rationale: string;
  status: "queued" | "running" | "success" | "failed" | "blocked" | "timeout";
  findings: number;
  jobId: string;
  durationMs: number;
  errorMessage?: string;
};

export type ChainRunResponse = {
  engagementId: string;
  targetUrl?: string;
  source: "claude" | "heuristic";
  message?: string;
  stepsPlanned: number;
  stepsExecuted: number;
  haltedAt?: {
    step: number;
    reason: string;
    haltCode?: string;
    haltReason?: string;
  } | null;
  chainStatus?: {
    executedSteps: number;
    totalSteps: number;
    haltedAtStep: number | null;
    haltReason: string | null;
    haltCode: string | null;
  };
  chainResults: ChainExecutionResult[];
};

export type EvidenceVerifyResponse = {
  engagementId: string;
  valid: boolean;
  totalItems: number;
  latestChainIndex?: number;
  brokenAt?: number;
  reason?: string;
  verifiedAt: string;
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
  count?: number;
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

export type PromptVersionRecord = {
  _id: string;
  promptType: "planning" | "tagging" | "chain" | "learning" | "research";
  version: string;
  parentVersion: string;
  evolutionReason: string;
  isActive: boolean;
  createdByAI: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type PromptActiveResponse = {
  promptTypesSupported: string[];
  active: PromptVersionRecord[];
};

export type PromptHistoryResponse = {
  count: number;
  history: PromptVersionRecord[];
};

export type PromptEvolutionResult = {
  promptType: string;
  status: "evolved" | "skipped";
  reason?: string;
  version?: string;
  confidenceScore?: number;
  sourceModel?: string;
  filePath?: string;
};

export type PromptEvolutionResponse = {
  triggeredAt: string;
  evolvedCount: number;
  skippedCount: number;
  metrics: {
    totalEngagementsUsed: number;
    avgFindingsPerEngagement: number;
    avgPlanQualityScore: number;
    successRate: number;
  };
  results: PromptEvolutionResult[];
};

export type OrchestratorStatusResponse = {
  activeCount: number;
  maxConcurrent: number;
  active: Record<
    string,
    {
      engagementId: string;
      targetUrl: string;
      startedAt: string;
      startedBy: string;
      state: string;
      step: number;
      totalSteps: number;
      lastUpdateAt: string;
    }
  >;
};

export type OrchestrationBatchResponse = {
  requested: number;
  scheduled: number;
  skipped: Array<{
    engagementId: string;
    reason: string;
  }>;
  maxConcurrent: number;
  currentlyActive: number;
  results: Array<{
    engagementId: string;
    status: "fulfilled" | "rejected";
    result: unknown;
  }>;
};

export type OrchestrationSingleResponse = {
  engagementId: string;
  targetUrl: string;
  status: "completed";
  promptVersion: string;
  plannerSource: string;
  toolSequence: string[];
  executionResults: Array<{
    toolId: string;
    status: string;
    findings: number;
    durationMs: number;
    jobId: string;
  }>;
  learningResult: unknown;
};

export type ResearchSourceResult = {
  source: string;
  status: "ok" | "error";
  fetchedCount: number;
  generatedPatterns: number;
  summary?: string;
  error?: string;
};

export type ResearchRunResult = {
  runId: string;
  trigger: "manual" | "cron" | "startup";
  sourcesChecked: number;
  newPatternsCreated: number;
  updatedPatterns: number;
  promptEvolutionTriggered: boolean;
  summary: string;
  sourceResults: ResearchSourceResult[];
  errors: string[];
};

export type ResearchRunTriggered = {
  status: "triggered";
  message: string;
};

export type ResearchRunResponse = ResearchRunResult | ResearchRunTriggered;

export type ResearchLogEntry = {
  _id: string;
  trigger: "manual" | "cron" | "startup";
  createdBy: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sourcesChecked: number;
  newPatternsCreated: number;
  promptEvolutionTriggered: boolean;
  summary: string;
  sourceResults: ResearchSourceResult[];
  errors: string[];
  createdAt: string;
};

export type ResearchLogsResponse = {
  count: number;
  logs: ResearchLogEntry[];
};

export type AdminFixAllResponse = {
  success: boolean;
  results: {
    orphanedJobsCleaned: number;
    whitelistsFixed: number;
    draftsFixed: number;
    draftStatusWritten?: string;
    whitelist?: string[];
  };
};

export type RealtimeTokenResponse = {
  token: string;
  engagementId?: string | null;
  wsPath: string;
  expiresInMs: number;
};

export type RealtimeStatusResponse = {
  enabled: boolean;
  totalSockets: number;
  rooms: Record<string, number>;
  tokenTtlMs: number;
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

export type DecisionBriefRisk = {
  rank: number;
  title: string;
  whyThisFirst: string;
  whatCouldHappen: string;
  fixDifficulty: "easy" | "medium" | "hard";
  estimatedFixTime: string;
  immediateAction: string;
};

export type DecisionBrief = {
  _id?: string;
  engagementId: string;
  topRisks: DecisionBriefRisk[];
  ignoreList: Array<{ title: string; reason: string }>;
  overallRiskSentence: string;
  riskLevel: "critical" | "high" | "medium" | "low" | "clean" | "unknown";
  shouldPageOnCall: boolean;
  riskScore: number;
  totalFindings: number;
  actionableFindings: number;
  ignoredFindings: number;
  source: "heuristic" | "claude";
  generatedAt: string;
};

export type ScopeDashboard = {
  engagementId: string;
  targetUrl: string;
  allowedDomains: string[];
  restrictedPaths: string[];
  restrictedServices: string[];
  noDestructiveOps: boolean;
  quietMode: boolean;
  maxConcurrentOps: number;
  timeoutMinutes: number;
  plannedTools: string[];
};

export type ActionPreview = {
  engagementId: string;
  targetUrl: string;
  actions: Array<{
    order: number;
    toolId: string;
    riskLevel: "low" | "medium" | "high";
    destructive: boolean;
    description: string;
  }>;
};

export type KillSwitchState = {
  blocked: boolean;
  global: {
    active: boolean;
    reason: string;
    updatedAt: string | null;
    updatedBy: string;
  };
  engagement: {
    active: boolean;
    reason: string;
    updatedAt: string | null;
    updatedBy: string;
  };
};

export type ActivityLogItem = {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId: string;
  userRole: string;
  ip?: string;
  query?: Record<string, unknown>;
  bodyKeys?: string[];
  createdAt: string;
};

export type ActivityLogResponse = {
  count: number;
  logs: ActivityLogItem[];
};

export type SecuritySnapshot = {
  _id: string;
  engagementId: string;
  snapshotType: "manual" | "scheduled" | "post-engagement";
  snapshotAt: string;
  findings: Array<{
    id?: string;
    title: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    category?: string;
    cve?: string;
  }>;
  openPorts: Array<{
    host: string;
    port: number;
    protocol: string;
    service: string;
  }>;
  riskScore: number;
  summary: string;
  createdBy: string;
};

export type SecurityChangeSet = {
  changesFound: boolean;
  newFindings: SecuritySnapshot["findings"];
  resolvedFindings: SecuritySnapshot["findings"];
  newPorts: SecuritySnapshot["openPorts"];
  closedPorts: SecuritySnapshot["openPorts"];
  changeSummary: string;
  scanGapHours: number;
  currentSnapshotId: string | null;
  previousSnapshotId: string | null;
};

function buildHeaders(session: VenomSession) {
  return {
    "Content-Type": "application/json",
    "x-user-id": session.email,
    "x-user-role": session.role
  };
}

const API_TIMEOUT_MS = 15000;
const STARTUP_TOOL_WHITELIST = [
  "http_headers_probe",
  "tls_metadata_probe",
  "dns_lookup_probe",
  "nuclei_scan",
  "nikto_scan",
  "nmap_tcp_scan",
  "sqlmap_detect"
];

async function apiFetch(
  path: string,
  init: RequestInit,
  timeoutMs = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

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
        `Bridge timeout after ${timeoutMs}ms. Backend may be offline or unreachable.`
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
      if (payloadError) {
        throw new Error(payloadError);
      }
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
      scanProfile: input.scanProfile,
      startupConcern: input.startupConcern,
      ownershipAssertion: input.ownershipAssertion,
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
        toolWhitelist: STARTUP_TOOL_WHITELIST,
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

export async function runAssessmentChain(
  session: VenomSession,
  engagementId: string
): Promise<ChainRunResponse> {
  const response = await apiFetch(`/api/chain/${encodeURIComponent(engagementId)}`, {
    method: "POST",
    headers: buildHeaders(session)
  }, 120000);

  return parseResponse<ChainRunResponse>(response);
}

export async function verifyEvidenceChain(
  session: VenomSession,
  engagementId: string
): Promise<EvidenceVerifyResponse> {
  const response = await apiFetch(
    `/api/evidence/${encodeURIComponent(engagementId)}/verify`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );

  return parseResponse<EvidenceVerifyResponse>(response);
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
  }, 60000);

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
    },
    45000
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
    },
    60000
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throwApiError(response, payload);
  }

  return response.blob();
}

export async function downloadBackendMarkdownReport(
  session: VenomSession,
  engagementId: string
): Promise<string> {
  const response = await apiFetch(
    `/api/reports/${encodeURIComponent(engagementId)}/md`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    },
    45000
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throwApiError(response, payload);
  }

  return response.text();
}

export async function fetchPromptActive(
  session: VenomSession
): Promise<PromptActiveResponse> {
  const response = await apiFetch("/api/prompts/active", {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<PromptActiveResponse>(response);
}

export async function fetchPromptHistory(
  session: VenomSession,
  promptType?: string,
  limit = 20
): Promise<PromptHistoryResponse> {
  const query = new URLSearchParams();
  query.set("limit", String(limit));
  if (promptType) {
    query.set("promptType", promptType);
  }

  const response = await apiFetch(`/api/prompts/history?${query.toString()}`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<PromptHistoryResponse>(response);
}

export async function evolvePromptsNow(
  session: VenomSession,
  promptTypes?: string[]
): Promise<PromptEvolutionResponse> {
  const response = await apiFetch("/api/prompts/evolve", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({
      promptTypes: Array.isArray(promptTypes) ? promptTypes : undefined
    })
  }, 120000);

  return parseResponse<PromptEvolutionResponse>(response);
}

export async function fetchOrchestratorStatus(
  session: VenomSession
): Promise<OrchestratorStatusResponse> {
  const response = await apiFetch("/api/orchestrate/status", {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<OrchestratorStatusResponse>(response);
}

export async function orchestrateMultipleEngagements(
  session: VenomSession,
  engagementIds: string[]
): Promise<OrchestrationBatchResponse> {
  const response = await apiFetch("/api/orchestrate", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({
      engagementIds
    })
  }, 300000);

  return parseResponse<OrchestrationBatchResponse>(response);
}

export async function orchestrateSingleEngagement(
  session: VenomSession,
  engagementId: string
): Promise<OrchestrationSingleResponse> {
  const response = await apiFetch(`/api/orchestrate/${encodeURIComponent(engagementId)}`, {
    method: "POST",
    headers: buildHeaders(session)
  }, 300000);

  return parseResponse<OrchestrationSingleResponse>(response);
}

export async function fetchRealtimeToken(
  session: VenomSession,
  engagementId?: string
): Promise<RealtimeTokenResponse> {
  const query = new URLSearchParams();
  if (engagementId) {
    query.set("engagementId", engagementId);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`/api/realtime/token${suffix}`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<RealtimeTokenResponse>(response);
}

export async function fetchRealtimeStatus(
  session: VenomSession
): Promise<RealtimeStatusResponse> {
  const response = await apiFetch("/api/realtime/status", {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<RealtimeStatusResponse>(response);
}

export async function fetchResearchLogs(
  session: VenomSession,
  limit = 20
): Promise<ResearchLogsResponse> {
  const response = await apiFetch(`/api/research/log?limit=${encodeURIComponent(String(limit))}`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });

  return parseResponse<ResearchLogsResponse>(response);
}

export async function triggerResearchCycle(
  session: VenomSession,
  sourceFilter?: string[]
): Promise<ResearchRunResponse> {
  const response = await apiFetch("/api/research/trigger", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({
      sourceFilter: Array.isArray(sourceFilter) ? sourceFilter : undefined
    })
  }, 120000);

  return parseResponse<ResearchRunResponse>(response);
}

export async function triggerAdminFixAll(
  session: VenomSession
): Promise<AdminFixAllResponse> {
  const response = await apiFetch("/api/admin/fix-all", {
    method: "POST",
    headers: buildHeaders(session)
  }, 120000);

  return parseResponse<AdminFixAllResponse>(response);
}

export async function fetchDecisionBrief(
  session: VenomSession,
  engagementId: string,
  generate = false
): Promise<DecisionBrief> {
  const query = generate ? "?generate=true" : "";
  const response = await apiFetch(
    `/api/decisions/${encodeURIComponent(engagementId)}/brief${query}`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );

  return parseResponse<DecisionBrief>(response);
}

export async function generateDecisionBriefNow(
  session: VenomSession,
  engagementId: string
): Promise<DecisionBrief> {
  const response = await apiFetch(
    `/api/decisions/${encodeURIComponent(engagementId)}/brief`,
    {
      method: "POST",
      headers: buildHeaders(session)
    },
    45000
  );
  return parseResponse<DecisionBrief>(response);
}

export async function fetchScopeDashboard(
  session: VenomSession,
  engagementId: string
): Promise<ScopeDashboard> {
  const response = await apiFetch(
    `/api/control/scope/${encodeURIComponent(engagementId)}`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );
  return parseResponse<ScopeDashboard>(response);
}

export async function fetchActionPreview(
  session: VenomSession,
  engagementId: string
): Promise<ActionPreview> {
  const response = await apiFetch(
    `/api/control/preview/${encodeURIComponent(engagementId)}`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );
  return parseResponse<ActionPreview>(response);
}

export async function fetchKillSwitchState(
  session: VenomSession,
  engagementId?: string
): Promise<KillSwitchState> {
  const query = engagementId
    ? `?engagementId=${encodeURIComponent(engagementId)}`
    : "";
  const response = await apiFetch(`/api/control/killswitch${query}`, {
    method: "GET",
    headers: buildHeaders(session),
    cache: "no-store"
  });
  return parseResponse<KillSwitchState>(response);
}

export async function setGlobalKillSwitchState(
  session: VenomSession,
  active: boolean,
  reason = ""
): Promise<KillSwitchState> {
  const response = await apiFetch("/api/control/killswitch/global", {
    method: "POST",
    headers: buildHeaders(session),
    body: JSON.stringify({ active, reason })
  });
  return parseResponse<KillSwitchState>(response);
}

export async function setEngagementKillSwitchState(
  session: VenomSession,
  engagementId: string,
  active: boolean,
  reason = ""
): Promise<KillSwitchState> {
  const response = await apiFetch(
    `/api/control/killswitch/engagement/${encodeURIComponent(engagementId)}`,
    {
      method: "POST",
      headers: buildHeaders(session),
      body: JSON.stringify({ active, reason })
    }
  );
  return parseResponse<KillSwitchState>(response);
}

export async function fetchActivityLogs(
  session: VenomSession,
  limit = 25
): Promise<ActivityLogResponse> {
  const response = await apiFetch(
    `/api/control/activity/recent?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );
  return parseResponse<ActivityLogResponse>(response);
}

export async function fetchSecuritySnapshots(
  session: VenomSession,
  engagementId: string,
  limit = 20
): Promise<SecuritySnapshot[]> {
  const response = await apiFetch(
    `/api/monitoring/${encodeURIComponent(engagementId)}/snapshots?limit=${encodeURIComponent(String(limit))}`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );
  return parseResponse<SecuritySnapshot[]>(response);
}

export async function createSecuritySnapshot(
  session: VenomSession,
  engagementId: string,
  snapshotType: "manual" | "scheduled" | "post-engagement" = "manual"
): Promise<SecuritySnapshot> {
  const response = await apiFetch(
    `/api/monitoring/${encodeURIComponent(engagementId)}/snapshot`,
    {
      method: "POST",
      headers: buildHeaders(session),
      body: JSON.stringify({ snapshotType })
    }
  );
  return parseResponse<SecuritySnapshot>(response);
}

export async function fetchSecurityChanges(
  session: VenomSession,
  engagementId: string
): Promise<SecurityChangeSet> {
  const response = await apiFetch(
    `/api/monitoring/${encodeURIComponent(engagementId)}/changes`,
    {
      method: "GET",
      headers: buildHeaders(session),
      cache: "no-store"
    }
  );
  return parseResponse<SecurityChangeSet>(response);
}
