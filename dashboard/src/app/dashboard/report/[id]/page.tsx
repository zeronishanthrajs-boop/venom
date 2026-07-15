"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import Navigation from "@/components/Navigation";
import {
  fetchEngagementReport,
  fetchExecutionJobs,
  fetchComplianceSummary,
  fetchDecisionBrief,
  fetchOrchestratorStatus,
  fetchDetailedExecutionReport,
  downloadBackendPdfReport,
  ApiError,
  type ComplianceSummary,
  type DetailedExecutionReport,
  type DetailedReportFinding,
  type DecisionBrief,
  type EngagementReport,
  type ExecutionTimelineEntry,
  type ExecutionJob,
  type OrchestratorStatusResponse
} from "@/lib/api";
import ErrorBanner from "@/components/ErrorBanner";
import { fetchSession, type VenomSession } from "@/lib/session";

type FlattenedFinding = {
  key: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  tool: string;
  affectedPath: string;
  recommendation: string;
  rootCauseId?: string;
  rootCauseLabel?: string;
  instanceCount?: number;
  affectedAssets?: string[];
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  source?: string;
};

type DetailedReportState =
  | DetailedExecutionReport
  | {
      status: "generating";
      staleData?: DetailedExecutionReport | null;
    };

function isGeneratingDetailedReport(
  value: DetailedReportState
): value is Extract<DetailedReportState, { status: "generating" }> {
  return "status" in value && value.status === "generating";
}

function formatDate(value?: string) {
  if (!value) {
    return "Unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }
  return parsed.toLocaleString();
}

function findingTone(severity: FlattenedFinding["severity"]) {
  if (severity === "critical") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (severity === "high") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (severity === "medium") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (severity === "low") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function statusTone(status: string) {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "running") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function executionResultTone(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "PASSED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (normalized === "VULNERABLE") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (normalized === "BLOCKED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function flattenFindings(jobs: ExecutionJob[]) {
  const dedup = new Map<string, FlattenedFinding>();

  for (const job of jobs) {
    const findings = Array.isArray(job.findings)
      ? job.findings
      : Array.isArray(job.output?.findings)
        ? (job.output.findings as ExecutionJob["findings"])
        : [];

    for (const finding of findings || []) {
      const severity =
        finding?.severity === "critical" ||
        finding?.severity === "high" ||
        finding?.severity === "medium" ||
        finding?.severity === "low" ||
        finding?.severity === "info"
          ? finding.severity
          : "low";

      const key = `${finding?.id || ""}|${finding?.title || ""}|${finding?.source || job.toolId}`.toLowerCase();
      if (dedup.has(key)) {
        continue;
      }

      dedup.set(key, {
        key,
        title: String(finding?.title || "Untitled finding"),
        description: String(finding?.description || "No description provided."),
        severity,
        tool: String(finding?.source || job.toolId || "unknown_tool"),
        affectedPath: String(
          Array.isArray(finding?.affectedAssets) && finding.affectedAssets.length > 0
            ? finding.affectedAssets[0]
            : finding?.metadata?.path || finding?.metadata?.url || "n/a"
        ),
        recommendation: String(finding?.recommendation || "Review and remediate based on tool output."),
        rootCauseId: typeof finding?.rootCauseId === "string" ? finding.rootCauseId : undefined,
        rootCauseLabel:
          typeof finding?.rootCauseLabel === "string" ? finding.rootCauseLabel : undefined,
        instanceCount:
          typeof finding?.instanceCount === "number" ? finding.instanceCount : undefined,
        affectedAssets: Array.isArray(finding?.affectedAssets)
          ? finding.affectedAssets.map((asset) => String(asset))
          : []
      });
    }
  }

  return [...dedup.values()];
}

function buildSimpleFallbackAnswer(
  question: string,
  findings: FlattenedFinding[],
  report: EngagementReport | null,
  brief: DecisionBrief | null
) {
  const normalized = question.toLowerCase();
  const critical = findings.filter((item) => item.severity === "critical");
  const high = findings.filter((item) => item.severity === "high");

  if (normalized.includes("critical") || normalized.includes("urgent")) {
    if (critical.length === 0) {
      return "No critical findings are currently recorded. Focus first on the high-severity items while scan coverage completes.";
    }
    return `Critical focus: ${critical
      .slice(0, 3)
      .map((item) => item.title)
      .join("; ")}. Start with immediate containment, then patch and retest.`;
  }

  if (normalized.includes("what next") || normalized.includes("next step")) {
    const topRisks = brief?.topRisks?.slice(0, 3) || [];
    if (topRisks.length > 0) {
      return `Recommended next steps: ${topRisks
        .map((risk, index) => `${index + 1}) ${risk.immediateAction}`)
        .join(" ")}`;
    }

    const prioritized = [...critical, ...high].slice(0, 3);
    if (prioritized.length === 0) {
      return "Scan is still in progress. Once findings land, prioritize exploitable public-facing issues first.";
    }

    return `Next steps: ${prioritized
      .map((item, index) => `${index + 1}) ${item.recommendation}`)
      .join(" ")}`;
  }

  if (normalized.includes("status") || normalized.includes("progress")) {
    const status = report?.engagement?.status || "unknown";
    return `Current scan status is ${status}. Total findings so far: ${findings.length}.`;
  }

  if (normalized.includes("compliance") || normalized.includes("owasp")) {
    return "Compliance mapping is available in the report section. Use OWASP category counts and CVSS severity to prioritize remediation order.";
  }

  return `Current snapshot: ${findings.length} findings (${critical.length} critical, ${high.length} high). Ask about urgent risks, remediation order, or a specific finding title for deeper guidance.`;
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function AIChatSidebar({
  engagementId,
  findings,
  report,
  brief
}: {
  engagementId: string;
  findings: FlattenedFinding[];
  report: EngagementReport | null;
  brief: DecisionBrief | null;
}) {
  const defaultMessage: ChatMessage = {
    role: "assistant",
    content:
      "Ask me about findings, severity, risk priority, or remediation order for this scan.",
    source: "system"
  };
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === "undefined") {
      return [defaultMessage];
    }

    const storageKey = `venom_report_chat_${engagementId}`;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return [defaultMessage];
      }
      const parsed = JSON.parse(raw) as ChatMessage[];
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return [defaultMessage];
      }
      const sanitized = parsed
        .filter((item) => item && (item.role === "user" || item.role === "assistant"))
        .map((item) => ({
          role: item.role,
          content: String(item.content || ""),
          source: item.source ? String(item.source) : undefined
        }))
        .filter((item) => item.content.trim().length > 0)
        .slice(-60);
      return sanitized.length > 0 ? sanitized : [defaultMessage];
    } catch {
      return [defaultMessage];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const storageKey = `venom_report_chat_${engagementId}`;

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-60)));
    } catch {
      // no-op: local history is best-effort
    }
  }, [messages, storageKey]);

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) {
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: question };
    const conversation = [...messages.slice(-6), userMessage];
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/assistant/report-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          engagementId,
          question,
          conversation,
          reportSnapshot: {
            status: report?.engagement?.status || "unknown",
            findingsCount: findings.length,
            topFindings: findings.slice(0, 8).map((item) => ({
              severity: item.severity,
              title: item.title,
              recommendation: item.recommendation
            })),
            topRisks: brief?.topRisks?.slice(0, 3) || []
          }
        })
      });

      const payload = (await response.json().catch(() => ({}))) as {
        answer?: string;
        source?: string;
      };
      const answerText = String(payload.answer || "").trim();

      if (!response.ok || !answerText) {
        throw new Error("Chat service unavailable");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: answerText,
          source: payload.source || "assistant"
        }
      ]);
    } catch {
      const fallback = buildSimpleFallbackAnswer(question, findings, report, brief);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: fallback,
          source: "fallback"
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-blue-700">Ask AI</h3>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-[92%] rounded-lg border px-3 py-2 text-sm ${
              message.role === "user"
                ? "ml-auto border-blue-200 bg-blue-50 text-blue-900"
                : "border-slate-200 bg-slate-50 text-slate-800"
            }`}
          >
            <p className="whitespace-pre-wrap">{message.content}</p>
            {message.source ? (
              <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-slate-500">
                {message.source}
              </p>
            ) : null}
          </div>
        ))}

        {loading ? (
          <div className="max-w-[92%] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Thinking...
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Ask about risks, findings, or next actions"
            disabled={loading}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-70"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function ReportPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const engagementId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const [session, setSession] = useState<VenomSession | null>(null);
  const [report, setReport] = useState<EngagementReport | null>(null);
  const [detailedReport, setDetailedReport] = useState<DetailedReportState | null>(null);
  const [jobs, setJobs] = useState<ExecutionJob[]>([]);
  const [compliance, setCompliance] = useState<ComplianceSummary | null>(null);
  const [brief, setBrief] = useState<DecisionBrief | null>(null);
  const [orchestratorStatus, setOrchestratorStatus] =
    useState<OrchestratorStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<Error | ApiError | string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [kickoffStatus, setKickoffStatus] = useState<
    "idle" | "triggering" | "triggered" | "failed"
  >("idle");
  const [kickoffMessage, setKickoffMessage] = useState("");
  const autoKickoffTriggered = useRef(false);

  const findings = useMemo(() => flattenFindings(jobs), [jobs]);

  const effectiveDetailedReport = useMemo(() => {
    if (!detailedReport) {
      return null;
    }
    if (isGeneratingDetailedReport(detailedReport)) {
      return detailedReport.staleData || null;
    }
    return detailedReport as DetailedExecutionReport;
  }, [detailedReport]);

  const isDetailedReportGenerating = useMemo(() => {
    return detailedReport ? isGeneratingDetailedReport(detailedReport) : false;
  }, [detailedReport]);

  const findingSummary = useMemo(
    () => ({
      critical: findings.filter((item) => item.severity === "critical").length,
      high: findings.filter((item) => item.severity === "high").length,
      medium: findings.filter((item) => item.severity === "medium").length,
      low: findings.filter((item) => item.severity === "low").length,
      info: findings.filter((item) => item.severity === "info").length
    }),
    [findings]
  );

  const isProcessing =
    report?.engagement?.status === "draft" || report?.engagement?.status === "running";

  useEffect(() => {
    let mounted = true;

    (async () => {
      const current = await fetchSession();
      if (!mounted) {
        return;
      }
      if (!current) {
        router.replace("/login");
        return;
      }
      setSession(current);
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (!session || !engagementId) {
      return;
    }
    const activeSession = session;

    let cancelled = false;

    async function loadData(initial = false) {
      if (initial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const reportPayload = await fetchEngagementReport(activeSession, engagementId);
        const [
          jobsPayload,
          compliancePayload,
          briefPayload,
          orchestratorPayload,
          detailedPayload
        ] =
          await Promise.all([
            fetchExecutionJobs(activeSession, engagementId),
            fetchComplianceSummary(activeSession, engagementId).catch(() => null),
            fetchDecisionBrief(activeSession, engagementId, reportPayload.engagement.status === "completed").catch(
              () => null
            ),
            fetchOrchestratorStatus(activeSession).catch(() => null),
            fetchDetailedExecutionReport(activeSession, engagementId).catch(() => null)
          ]);

        if (cancelled) {
          return;
        }

        setReport(reportPayload);
        setJobs(jobsPayload);
        setCompliance(compliancePayload);
        setBrief(briefPayload);
        setOrchestratorStatus(orchestratorPayload);
        setDetailedReport(detailedPayload);
        setError("");
      } catch (requestError) {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError
              : "Failed to load report."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadData(true);

    const timer = window.setInterval(() => {
      void loadData(false);
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [engagementId, session]);

  const triggerOrchestration = useCallback((manual = false) => {
    if (!engagementId) {
      return;
    }
    if (kickoffStatus === "triggering") {
      return;
    }

    setKickoffStatus("triggering");
    setKickoffMessage(
      manual
        ? "Trying to start orchestration..."
        : "Starting auto-orchestration for this engagement..."
    );

    void fetch(`/api/backend/api/orchestrate/${encodeURIComponent(engagementId)}?async=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({}),
      credentials: "include",
      keepalive: true
    })
      .then(async (response) => {
        if (response.ok) {
          setKickoffStatus("triggered");
          setKickoffMessage(
            "Auto-orchestration queued. Report will refresh automatically as jobs complete."
          );
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        const message = String(payload.error || "").trim();
        setKickoffStatus("failed");
        setKickoffMessage(message || "Failed to trigger orchestration. Please retry.");
      })
      .catch(() => {
        setKickoffStatus("failed");
        setKickoffMessage("Failed to trigger orchestration. Please retry.");
      });
  }, [engagementId, kickoffStatus]);

  useEffect(() => {
    if (!engagementId || !report) {
      return;
    }
    if (autoKickoffTriggered.current) {
      return;
    }

    const hasActiveRun = Boolean(orchestratorStatus?.active?.[engagementId]);
    const shouldKickoff =
      (report.engagement.status === "draft" ||
        report.engagement.status === "running") &&
      jobs.length === 0 &&
      !hasActiveRun;

    if (!shouldKickoff) {
      return;
    }

    autoKickoffTriggered.current = true;
    const kickoffTimer = window.setTimeout(() => {
      triggerOrchestration(false);
    }, 0);
    return () => {
      window.clearTimeout(kickoffTimer);
    };
  }, [engagementId, jobs.length, orchestratorStatus, report, triggerOrchestration]);

  async function handleDownload() {
    if (!session || !engagementId) {
      return;
    }

    setDownloading(true);
    try {
      const pdf = await downloadBackendPdfReport(session, engagementId);
      triggerBlobDownload(pdf, `venom-report-${engagementId}.pdf`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError
          : "Report download failed."
      );
    } finally {
      setDownloading(false);
    }
  }

  if (!engagementId) {
    return (
      <main className="min-h-screen bg-slate-100 text-slate-950 lg:flex">
        <Navigation />
        <section className="flex-1 px-4 py-8">
          <p className="mx-auto max-w-4xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Invalid report id.
          </p>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 text-slate-950 lg:flex">
        <Navigation />
        <section className="flex flex-1 flex-col items-center justify-center px-4 py-8">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
          <p className="mt-4 text-sm text-slate-600">Generating comprehensive report...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-28 text-slate-950 lg:flex">
      <Navigation />

      <section className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                Executive report
              </span>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Security Assessment Report
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                {report?.engagement?.targetUrl || "Unknown target"}
              </p>
            </div>

            <div className="text-right">
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusTone(
                  report?.engagement?.status || "draft"
                )}`}
              >
                {report?.engagement?.status || "unknown"}
              </span>
              <p className="mt-2 text-xs text-slate-500">
                Last updated {formatDate(report?.generatedAt)}
                {refreshing ? " (refreshing...)" : ""}
              </p>
            </div>
          </div>

          {error ? (
            <div className="mt-4">
              <ErrorBanner error={error} onRetry={() => { setError(null); }} />
            </div>
          ) : null}

          {isProcessing ? (
            <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Scan is in progress. This report auto-refreshes every 5 seconds.
            </p>
          ) : null}

          {kickoffStatus !== "idle" ? (
            <p
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                kickoffStatus === "failed"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-blue-200 bg-blue-50 text-blue-700"
              }`}
            >
              {kickoffMessage}
            </p>
          ) : null}

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                What We Scanned
              </h2>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                <p>
                  <span className="text-slate-500">Target:</span>{" "}
                  {report?.engagement?.targetUrl || "n/a"}
                </p>
                <p>
                  <span className="text-slate-500">Scan Date:</span>{" "}
                  {formatDate(report?.engagement?.createdAt)}
                </p>
                <p>
                  <span className="text-slate-500">Jobs Run:</span>{" "}
                  {report?.summary?.totalExecutionJobs ?? 0}
                </p>
                <p>
                  <span className="text-slate-500">Planner Source:</span>{" "}
                  {report?.latestPlan?.plannerSource || "template"}
                </p>
                <p>
                  <span className="text-slate-500">Evidence Capture:</span> Enabled
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                What We Found
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Critical", findingSummary.critical, "critical"],
                  ["High", findingSummary.high, "high"],
                  ["Medium", findingSummary.medium, "medium"],
                  ["Low", findingSummary.low, "low"],
                  ["Info", findingSummary.info, "info"]
                ].map(([label, value, tone]) => (
                  <div
                    key={String(label)}
                    className={`rounded-lg border px-2 py-2 text-center ${findingTone(
                      tone as FlattenedFinding["severity"]
                    )}`}
                  >
                    <p className="text-lg font-semibold leading-tight">{value}</p>
                    <p className="text-[10px] uppercase tracking-wide">{label}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Scan Execution Details
            </h2>

            {effectiveDetailedReport?.executionDetails ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-slate-950">
                      {effectiveDetailedReport.executionDetails.totalTests}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Tests Run</p>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-emerald-700">
                      {effectiveDetailedReport.executionDetails.passed}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-emerald-700">Passed</p>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-rose-700">
                      {effectiveDetailedReport.executionDetails.failed}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-rose-700">Vulnerable</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-amber-700">
                      {effectiveDetailedReport.executionDetails.blocked + effectiveDetailedReport.executionDetails.errored}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-amber-700">Blocked/Error</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-blue-700">
                      {effectiveDetailedReport.executionDetails.totalTimeMs}ms
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-blue-700">Total Time</p>
                  </div>
                </div>

                {isDetailedReportGenerating ? (
                  <div className="mt-4 flex animate-pulse items-center gap-2 text-xs text-blue-700">
                    <div className="h-3 w-3 animate-spin rounded-full border border-slate-200 border-t-blue-600" />
                    <span>Updating trace details in the background...</span>
                  </div>
                ) : null}

                {effectiveDetailedReport.executionDetails.timeline.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-500">
                      Execution Timeline
                    </p>
                    <div className="mt-2 space-y-2">
                      {effectiveDetailedReport.executionDetails.timeline.slice(0, 25).map((item: ExecutionTimelineEntry) => (
                        <div
                          key={item.testId}
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${executionResultTone(
                            item.result
                          )}`}
                        >
                          <div>
                            <p className="font-semibold">{item.testName}</p>
                            <p className="text-[11px] opacity-80">{item.tool}</p>
                          </div>
                          <div className="text-right">
                            <p>{item.timeMs}ms</p>
                            <p className="text-[11px] uppercase tracking-wide">{item.result}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {effectiveDetailedReport.detailedFindings.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-500">
                      Finding Traceability
                    </p>
                    <div className="mt-2 space-y-2">
                      {effectiveDetailedReport.detailedFindings.slice(0, 12).map((finding: DetailedReportFinding) => (
                        <article
                          key={`${finding.id}-${finding.title}`}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                              {finding.severity}
                            </span>
                            <p className="text-sm font-semibold text-slate-950">{finding.title}</p>
                          </div>
                          <p className="mt-2 text-xs text-slate-600">
                            {finding.executionTrace?.result?.reason || finding.whatFound}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
                            <span>
                              Test: {finding.executionTrace?.test?.name || "not linked"}
                            </span>
                            <span>
                              Confidence: {Math.round((finding.executionTrace?.result?.confidence || 0) * 100)}%
                            </span>
                            <span>
                              Time: {finding.executionTrace?.executionTimeMs || 0}ms
                            </span>
                          </div>
                          {finding.developerNotes ? (
                            <p className="mt-2 text-xs text-blue-700">
                              Developer Notes: {finding.developerNotes}
                            </p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : isDetailedReportGenerating ? (
              <div className="mt-3 flex animate-pulse items-center gap-2 text-sm text-blue-700">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
                <span>Generating detailed execution trace in the background...</span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Detailed execution trace is not available yet.
              </p>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Detailed Findings
            </h2>

            {findings.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No findings recorded yet. Wait for orchestration to complete.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {findings.slice(0, 40).map((finding) => (
                  <article
                    key={finding.key}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${findingTone(
                          finding.severity
                        )}`}
                      >
                        {finding.severity}
                      </span>
                      <h3 className="text-sm font-semibold text-slate-950">{finding.title}</h3>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{finding.description}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                      <span>Tool: {finding.tool}</span>
                      <span>
                        {finding.rootCauseId ? "Root Cause" : "Affected"}:{" "}
                        {finding.rootCauseLabel || finding.affectedPath}
                      </span>
                      {finding.instanceCount && finding.instanceCount > 1 ? (
                        <span>Instances: {finding.instanceCount}</span>
                      ) : null}
                    </div>
                    {finding.affectedAssets && finding.affectedAssets.length > 0 ? (
                      <details className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        <summary className="cursor-pointer text-blue-700">
                          Affected assets ({finding.affectedAssets.length})
                        </summary>
                        <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto">
                          {finding.affectedAssets.map((asset) => (
                            <li key={asset} className="break-all text-slate-500">
                              {asset}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <p className="mt-2 text-xs text-blue-700">
                      Recommendation: {finding.recommendation}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Our Analysis
              </h2>

              {brief?.topRisks?.length ? (
                <ol className="mt-3 space-y-2 text-sm text-slate-700">
                  {brief.topRisks.slice(0, 3).map((risk, index) => (
                    <li key={`${risk.rank}-${risk.title}`}>
                      {index + 1}. <span className="font-semibold">{risk.title}:</span>{" "}
                      {risk.whyThisFirst}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  Decision brief not available yet. Insights will populate after scan completion.
                </p>
              )}

              {report?.patternMatches?.length ? (
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-[0.08em] text-slate-500">
                    Pattern Signals
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {report.patternMatches.slice(0, 4).map((pattern) => (
                      <li key={pattern.patternId}>
                        {pattern.patternName} ({pattern.applicabilityScore.toFixed(2)})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Compliance and Evidence
              </h2>

              {compliance ? (
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <p>
                    CVSS Score: <span className="font-semibold">{compliance.cvssOverallScore.toFixed(2)}</span>
                  </p>
                  <p>
                    CVSS Severity: <span className="font-semibold">{compliance.cvssSeverity}</span>
                  </p>
                  <p>
                    OWASP Coverage: <span className="font-semibold">{compliance.owaspCoverage}</span>
                  </p>
                  <p>
                    OWASP Rating: <span className="font-semibold">{compliance.owaspRating}</span>
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  Compliance map is not available yet.
                </p>
              )}

              {orchestratorStatus?.active?.[engagementId] ? (
                <p className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  Active orchestration step {orchestratorStatus.active[engagementId].step}/
                  {orchestratorStatus.active[engagementId].totalSteps}
                </p>
              ) : null}
            </section>
          </div>
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setShowChat((prev) => !prev)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-blue-700"
          >
            {showChat ? "Close AI Chat" : "Ask AI About Findings"}
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {downloading ? "Preparing Download..." : "Download Full Report"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/recent")}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-50"
          >
            View Other Reports
          </button>
          {kickoffStatus === "failed" ? (
            <button
              type="button"
              onClick={() => triggerOrchestration(true)}
              className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-700 transition hover:bg-blue-100"
            >
              Retry Scan Start
            </button>
          ) : null}
        </div>
      </div>

      {showChat ? (
        <AIChatSidebar
          engagementId={engagementId}
          findings={findings}
          report={report}
          brief={brief}
        />
      ) : null}
    </main>
  );
}
