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
  downloadBackendMarkdownReport,
  ApiError,
  type ComplianceSummary,
  type DetailedExecutionReport,
  type DecisionBrief,
  type EngagementReport,
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
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  source?: string;
};

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
    return "border-rose-500/65 bg-rose-500/10 text-rose-100";
  }
  if (severity === "high") {
    return "border-orange-500/60 bg-orange-500/10 text-orange-100";
  }
  if (severity === "medium") {
    return "border-amber-500/60 bg-amber-500/10 text-amber-100";
  }
  if (severity === "low") {
    return "border-cyan-500/60 bg-cyan-500/10 text-cyan-100";
  }
  return "border-slate-600 bg-slate-700 text-slate-200";
}

function statusTone(status: string) {
  if (status === "completed") {
    return "border-cyan-500/45 bg-cyan-500/10 text-cyan-100";
  }
  if (status === "running") {
    return "border-lime-500/45 bg-lime-500/10 text-lime-100";
  }
  if (status === "failed") {
    return "border-rose-500/45 bg-rose-500/10 text-rose-100";
  }
  return "border-slate-600 bg-slate-700 text-slate-200";
}

function executionResultTone(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "PASSED") {
    return "border-lime-500/45 bg-lime-500/10 text-lime-100";
  }
  if (normalized === "VULNERABLE") {
    return "border-rose-500/45 bg-rose-500/10 text-rose-100";
  }
  if (normalized === "BLOCKED") {
    return "border-amber-500/45 bg-amber-500/10 text-amber-100";
  }
  return "border-slate-600 bg-slate-700 text-slate-200";
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
        affectedPath: String(finding?.metadata?.path || finding?.metadata?.url || "n/a"),
        recommendation: String(finding?.recommendation || "Review and remediate based on tool output.")
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
    <aside className="fixed right-0 top-[69px] z-40 flex h-[calc(100vh-69px)] w-full max-w-md flex-col border-l border-slate-700 bg-[#0a111a]/98 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-lime-200">Ask AI</h3>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`max-w-[92%] rounded-lg border px-3 py-2 text-sm ${
              message.role === "user"
                ? "ml-auto border-lime-400/40 bg-lime-500/10 text-lime-100"
                : "border-slate-700 bg-slate-900/90 text-slate-100"
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
          <div className="max-w-[92%] rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-400">
            Thinking...
          </div>
        ) : null}
      </div>

      <div className="border-t border-slate-700 p-3">
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
            className="w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-lime-400 focus:ring-2 focus:ring-lime-500/20 disabled:cursor-not-allowed disabled:opacity-70"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={loading}
            className="rounded-lg bg-lime-400 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-950 transition hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-70"
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
  const [detailedReport, setDetailedReport] = useState<any>(null);
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
    if (detailedReport.status === "generating") {
      return detailedReport.staleData || null;
    }
    return detailedReport as DetailedExecutionReport;
  }, [detailedReport]);

  const isDetailedReportGenerating = useMemo(() => {
    return detailedReport?.status === "generating";
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
      <main className="min-h-screen bg-[#06090f] text-slate-100">
        <Navigation />
        <section className="mx-auto max-w-4xl px-4 py-8">
          <p className="rounded-xl border border-rose-500/45 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            Invalid report id.
          </p>
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#06090f] text-slate-100">
        <Navigation />
        <section className="mx-auto flex min-h-[calc(100vh-69px)] max-w-4xl flex-col items-center justify-center px-4 py-8">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-lime-400" />
          <p className="mt-4 text-sm text-slate-300">Generating comprehensive report...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#06090f] pb-28 text-slate-100">
      <Navigation />

      <section className="mx-auto w-full max-w-6xl px-4 py-7">
        <div className="rounded-3xl border border-slate-700/80 bg-[#101722]/92 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.4)] sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <span className="inline-flex rounded-full border border-lime-400/45 bg-lime-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-lime-100">
                Screen 3 of 3
              </span>
              <h1 className="mt-3 text-2xl font-semibold sm:text-3xl">Security Assessment Report</h1>
              <p className="mt-2 text-sm text-slate-400">
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
            <p className="mt-4 rounded-lg border border-lime-500/40 bg-lime-500/10 px-3 py-2 text-sm text-lime-100">
              Scan is in progress. This report auto-refreshes every 5 seconds.
            </p>
          ) : null}

          {kickoffStatus !== "idle" ? (
            <p
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                kickoffStatus === "failed"
                  ? "border-rose-500/45 bg-rose-500/10 text-rose-200"
                  : "border-cyan-500/45 bg-cyan-500/10 text-cyan-100"
              }`}
            >
              {kickoffMessage}
            </p>
          ) : null}

          <div className="mt-6 grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-lime-200">
                What We Scanned
              </h2>
              <div className="mt-3 space-y-2 text-sm text-slate-200">
                <p>
                  <span className="text-slate-400">Target:</span>{" "}
                  {report?.engagement?.targetUrl || "n/a"}
                </p>
                <p>
                  <span className="text-slate-400">Scan Date:</span>{" "}
                  {formatDate(report?.engagement?.createdAt)}
                </p>
                <p>
                  <span className="text-slate-400">Jobs Run:</span>{" "}
                  {report?.summary?.totalExecutionJobs ?? 0}
                </p>
                <p>
                  <span className="text-slate-400">Planner Source:</span>{" "}
                  {report?.latestPlan?.plannerSource || "template"}
                </p>
                <p>
                  <span className="text-slate-400">Evidence Capture:</span> Enabled
                </p>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-lime-200">
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

          <section className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-lime-200">
              Scan Execution Details
            </h2>

            {effectiveDetailedReport?.executionDetails ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="rounded-lg border border-slate-700 bg-slate-950/70 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-slate-100">
                      {effectiveDetailedReport.executionDetails.totalTests}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">Tests Run</p>
                  </div>
                  <div className="rounded-lg border border-lime-500/45 bg-lime-500/10 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-lime-100">
                      {effectiveDetailedReport.executionDetails.passed}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-lime-200">Passed</p>
                  </div>
                  <div className="rounded-lg border border-rose-500/45 bg-rose-500/10 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-rose-100">
                      {effectiveDetailedReport.executionDetails.failed}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-rose-200">Vulnerable</p>
                  </div>
                  <div className="rounded-lg border border-amber-500/45 bg-amber-500/10 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-amber-100">
                      {effectiveDetailedReport.executionDetails.blocked + effectiveDetailedReport.executionDetails.errored}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-amber-200">Blocked/Error</p>
                  </div>
                  <div className="rounded-lg border border-cyan-500/45 bg-cyan-500/10 px-2 py-2 text-center">
                    <p className="text-lg font-semibold text-cyan-100">
                      {effectiveDetailedReport.executionDetails.totalTimeMs}ms
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-cyan-200">Total Time</p>
                  </div>
                </div>

                {isDetailedReportGenerating ? (
                  <div className="mt-4 flex items-center gap-2 text-xs text-lime-400/80 animate-pulse">
                    <div className="h-3 w-3 animate-spin rounded-full border border-slate-700 border-t-lime-400" />
                    <span>Updating trace details in the background...</span>
                  </div>
                ) : null}

                {effectiveDetailedReport.executionDetails.timeline.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-500">
                      Execution Timeline
                    </p>
                    <div className="mt-2 space-y-2">
                      {effectiveDetailedReport.executionDetails.timeline.slice(0, 25).map((item: any) => (
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
                      {effectiveDetailedReport.detailedFindings.slice(0, 12).map((finding: any) => (
                        <article
                          key={`${finding.id}-${finding.title}`}
                          className="rounded-lg border border-slate-700 bg-slate-950/65 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                              {finding.severity}
                            </span>
                            <p className="text-sm font-semibold text-slate-100">{finding.title}</p>
                          </div>
                          <p className="mt-2 text-xs text-slate-300">
                            {finding.executionTrace?.result?.reason || finding.whatFound}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
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
                            <p className="mt-2 text-xs text-lime-100">
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
              <div className="mt-3 flex items-center gap-2 text-sm text-lime-400/80 animate-pulse">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-lime-400" />
                <span>Generating detailed execution trace in the background...</span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                Detailed execution trace is not available yet.
              </p>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-lime-200">
              Detailed Findings
            </h2>

            {findings.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                No findings recorded yet. Wait for orchestration to complete.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {findings.slice(0, 40).map((finding) => (
                  <article
                    key={finding.key}
                    className="rounded-xl border border-slate-700 bg-slate-950/70 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${findingTone(
                          finding.severity
                        )}`}
                      >
                        {finding.severity}
                      </span>
                      <h3 className="text-sm font-semibold text-slate-100">{finding.title}</h3>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{finding.description}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>Tool: {finding.tool}</span>
                      <span>Affected: {finding.affectedPath}</span>
                    </div>
                    <p className="mt-2 text-xs text-lime-100">
                      Recommendation: {finding.recommendation}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-lime-200">
                Our Analysis
              </h2>

              {brief?.topRisks?.length ? (
                <ol className="mt-3 space-y-2 text-sm text-slate-200">
                  {brief.topRisks.slice(0, 3).map((risk, index) => (
                    <li key={`${risk.rank}-${risk.title}`}>
                      {index + 1}. <span className="font-semibold">{risk.title}:</span>{" "}
                      {risk.whyThisFirst}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-sm text-slate-400">
                  Decision brief not available yet. Insights will populate after scan completion.
                </p>
              )}

              {report?.patternMatches?.length ? (
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-[0.08em] text-slate-500">
                    Pattern Signals
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-300">
                    {report.patternMatches.slice(0, 4).map((pattern) => (
                      <li key={pattern.patternId}>
                        {pattern.patternName} ({pattern.applicabilityScore.toFixed(2)})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-lime-200">
                Compliance and Evidence
              </h2>

              {compliance ? (
                <div className="mt-3 space-y-2 text-sm text-slate-200">
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
                <p className="mt-3 text-sm text-slate-400">
                  Compliance map is not available yet.
                </p>
              )}

              {orchestratorStatus?.active?.[engagementId] ? (
                <p className="mt-4 rounded-lg border border-lime-400/35 bg-lime-500/10 px-3 py-2 text-xs text-lime-100">
                  Active orchestration step {orchestratorStatus.active[engagementId].step}/
                  {orchestratorStatus.active[engagementId].totalSteps}
                </p>
              ) : null}
            </section>
          </div>
        </div>
      </section>

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-700 bg-[#090f16]/95 p-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setShowChat((prev) => !prev)}
            className="rounded-lg bg-lime-400 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-950 transition hover:bg-lime-300"
          >
            {showChat ? "Close AI Chat" : "Ask AI About Findings"}
          </button>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-100 transition hover:border-lime-400/45 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {downloading ? "Preparing Download..." : "Download Full Report"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/dashboard/recent")}
            className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-100 transition hover:border-slate-400"
          >
            View Other Reports
          </button>
          {kickoffStatus === "failed" ? (
            <button
              type="button"
              onClick={() => triggerOrchestration(true)}
              className="rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-cyan-100 transition hover:bg-cyan-500/20"
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
