"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createEngagement,
  downloadBackendPdfReport,
  deleteEngagement,
  emailBackendReport,
  fetchAlerts,
  fetchAllProgress,
  fetchComplianceSummary,
  fetchCveSummary,
  fetchExecutionJobs,
  fetchEngagementReport,
  fetchMetricsOverview,
  fetchMatchedPatterns,
  fetchPlansForEngagement,
  fetchEngagements,
  generatePlan,
  runLearning,
  runExecutionJob,
  syncCves,
  type AlertItem,
  type CveSummary,
  type ComplianceSummary,
  type CreateEngagementInput,
  type Engagement,
  type EngagementReport,
  type EngagementProgress,
  type ExecutionJob,
  type MetricsOverview,
  type Plan
} from "@/lib/api";
import { downloadEngagementReport, type ReportViewMode } from "@/lib/reports";
import { Switch } from "@/components/ui/switch";
import {
  fetchSession,
  logoutSession,
  type VenomSession
} from "@/lib/session";

const emptyForm: CreateEngagementInput = {
  name: "",
  description: "",
  targetUrl: "",
  targetType: "website"
};

function formatDate(value?: string) {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14H5V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<VenomSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [form, setForm] = useState<CreateEngagementInput>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [planningById, setPlanningById] = useState<Record<string, boolean>>({});
  const [executingById, setExecutingById] = useState<Record<string, boolean>>({});
  const [matchingById, setMatchingById] = useState<Record<string, boolean>>({});
  const [learningById, setLearningById] = useState<Record<string, boolean>>({});
  const [latestPlanByEngagement, setLatestPlanByEngagement] = useState<
    Record<string, Plan | null>
  >({});
  const [latestExecutionByEngagement, setLatestExecutionByEngagement] = useState<
    Record<string, ExecutionJob | null>
  >({});
  const [topMatchByEngagement, setTopMatchByEngagement] = useState<
    Record<string, { name: string; score: number } | null>
  >({});
  const [learningSummaryByEngagement, setLearningSummaryByEngagement] = useState<
    Record<string, string | null>
  >({});
  const [reportByEngagement, setReportByEngagement] = useState<
    Record<string, EngagementReport | null>
  >({});
  const [viewModeByEngagement, setViewModeByEngagement] = useState<
    Record<string, ReportViewMode>
  >({});
  const [downloadingById, setDownloadingById] = useState<Record<string, boolean>>(
    {}
  );
  const [downloadingBackendPdfById, setDownloadingBackendPdfById] = useState<
    Record<string, boolean>
  >({});
  const [emailingReportById, setEmailingReportById] = useState<
    Record<string, boolean>
  >({});
  const [deletingById, setDeletingById] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [metricsOverview, setMetricsOverview] = useState<MetricsOverview | null>(
    null
  );
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [cveSummary, setCveSummary] = useState<CveSummary | null>(null);
  const [syncingCves, setSyncingCves] = useState(false);
  const [progressByEngagement, setProgressByEngagement] = useState<
    Record<string, EngagementProgress>
  >({});
  const [complianceByEngagement, setComplianceByEngagement] = useState<
    Record<string, ComplianceSummary | null>
  >({});
  const [complianceLoadingById, setComplianceLoadingById] = useState<
    Record<string, boolean>
  >({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      const currentSession = await fetchSession();

      if (!mounted) {
        return;
      }

      if (!currentSession) {
        router.replace("/login");
        return;
      }

      setSession(currentSession);
      setSessionReady(true);
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  async function loadEngagementData(
    activeSession: VenomSession,
    showLoader = true
  ) {
    if (showLoader) {
      setLoading(true);
    }
    setError("");
    try {
      const items = await fetchEngagements(activeSession);
      setEngagements(items);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load engagements."
      );
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }

  async function loadWeek7Telemetry(activeSession: VenomSession) {
    try {
      const [overview, alertPayload, progress, cves] = await Promise.all([
        fetchMetricsOverview(activeSession),
        fetchAlerts(activeSession),
        fetchAllProgress(activeSession),
        fetchCveSummary(activeSession)
      ]);
      setMetricsOverview(overview);
      setAlerts(alertPayload.alerts);
      setCveSummary(cves);
      setProgressByEngagement(
        progress.reduce<Record<string, EngagementProgress>>((acc, item) => {
          acc[item.engagementId] = item;
          return acc;
        }, {})
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load telemetry."
      );
    }
  }

  async function handleSyncCveFeed() {
    if (!session) {
      return;
    }

    setSyncingCves(true);
    setError("");
    setMessage("");

    try {
      const result = await syncCves(session, {
        sinceDays: 7,
        limit: 50
      });
      setMessage(
        `CVE sync complete: fetched ${result.fetched}, upserted ${result.upsertedCount}.`
      );
      await loadWeek7Telemetry(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to sync CVE feed."
      );
    } finally {
      setSyncingCves(false);
    }
  }

  useEffect(() => {
    if (!session) {
      return;
    }

    let mounted = true;
    (async () => {
      try {
        const items = await fetchEngagements(session);
        if (mounted) {
          setEngagements(items);
          setError("");
          await loadWeek7Telemetry(session);
        }
      } catch (requestError) {
        if (mounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Failed to load engagements."
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadWeek7Telemetry(session);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [session]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) {
      return;
    }

    setCreating(true);
    setError("");
    setMessage("");

    try {
      await createEngagement(session, form);
      setForm(emptyForm);
      setMessage("Engagement created successfully.");
      await loadEngagementData(session);
      await loadWeek7Telemetry(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to create engagement."
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleLogout() {
    await logoutSession();
    router.replace("/login");
  }

  const summary = useMemo(
    () => ({
      total: engagements.length,
      running: engagements.filter((item) => item.status === "running").length,
      draft: engagements.filter((item) => item.status === "draft").length
    }),
    [engagements]
  );
  const engagementPendingDelete = engagements.find(
    (item) => item._id === confirmDeleteId
  );

  async function handleGeneratePlan(engagementId: string) {
    if (!session) {
      return;
    }

    setPlanningById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const created = await generatePlan(session, engagementId);
      setLatestPlanByEngagement((prev) => ({
        ...prev,
        [engagementId]: created
      }));
      setMessage("Plan generated successfully.");
      await loadWeek7Telemetry(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to generate plan."
      );
    } finally {
      setPlanningById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleLoadLatestPlan(engagementId: string) {
    if (!session) {
      return;
    }

    try {
      const plans = await fetchPlansForEngagement(session, engagementId);
      setLatestPlanByEngagement((prev) => ({
        ...prev,
        [engagementId]: plans[0] || null
      }));
    } catch {
      // Keep the UI quiet here; generate action already surfaces useful errors.
    }
  }

  async function ensurePassiveReconPlan(engagementId: string) {
    if (!session) {
      return;
    }

    const plans = await fetchPlansForEngagement(session, engagementId);
    if (plans.length > 0) {
      setLatestPlanByEngagement((prev) => ({
        ...prev,
        [engagementId]: plans[0] || null
      }));
      return;
    }

    const generated = await generatePlan(session, engagementId);
    setLatestPlanByEngagement((prev) => ({
      ...prev,
      [engagementId]: generated
    }));
    setMessage(
      "No plans existed for this engagement. Passive reconnaissance fallback plan generated automatically."
    );
  }

  async function handleRunHeadersProbe(engagementId: string) {
    if (!session) {
      return;
    }

    setExecutingById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const job = await runExecutionJob(
        session,
        engagementId,
        "http_headers_probe"
      );
      setLatestExecutionByEngagement((prev) => ({
        ...prev,
        [engagementId]: job
      }));
      setMessage("Safe execution probe completed.");
      await loadWeek7Telemetry(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to execute probe."
      );
    } finally {
      setExecutingById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleLoadLatestExecution(engagementId: string) {
    if (!session) {
      return;
    }

    try {
      const jobs = await fetchExecutionJobs(session, engagementId);
      setLatestExecutionByEngagement((prev) => ({
        ...prev,
        [engagementId]: jobs[0] || null
      }));
    } catch {
      // no-op
    }
  }

  async function handleMatchPatterns(engagementId: string) {
    if (!session) {
      return;
    }

    setMatchingById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const result = await fetchMatchedPatterns(session, engagementId);
      const top = result.rankedPatterns[0];
      setTopMatchByEngagement((prev) => ({
        ...prev,
        [engagementId]: top
          ? { name: top.patternName, score: top.applicabilityScore }
          : null
      }));
      setMessage(
        top
          ? `Pattern match complete. Top pattern: ${top.patternName}.`
          : "Pattern match complete. No patterns ranked yet."
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to match patterns."
      );
    } finally {
      setMatchingById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleRunLearning(engagementId: string) {
    if (!session) {
      return;
    }

    setLearningById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const result = await runLearning(session, engagementId);
      const summary = result.message
        ? result.message
        : `Processed ${result.processedJobs} jobs and updated ${result.updatedPatterns.length} pattern(s).`;
      setLearningSummaryByEngagement((prev) => ({
        ...prev,
        [engagementId]: summary
      }));
      setMessage("Learning cycle completed.");
      await loadWeek7Telemetry(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to run learning."
      );
    } finally {
      setLearningById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleLoadCompliance(engagementId: string) {
    if (!session) {
      return;
    }

    setComplianceLoadingById((prev) => ({ ...prev, [engagementId]: true }));
    try {
      const summary = await fetchComplianceSummary(session, engagementId);
      setComplianceByEngagement((prev) => ({
        ...prev,
        [engagementId]: summary
      }));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load compliance summary."
      );
    } finally {
      setComplianceLoadingById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function loadReportForEngagement(
    engagementId: string,
    forceRefresh = false
  ) {
    if (!session) {
      return null;
    }

    const existing = reportByEngagement[engagementId];
    if (existing && !forceRefresh) {
      return existing;
    }

    const report = await fetchEngagementReport(session, engagementId);
    setReportByEngagement((prev) => ({
      ...prev,
      [engagementId]: report
    }));
    return report;
  }

  async function handleViewModeToggle(engagementId: string, checked: boolean) {
    const nextMode: ReportViewMode = checked ? "detailed" : "summary";
    setViewModeByEngagement((prev) => ({
      ...prev,
      [engagementId]: nextMode
    }));

    if (checked) {
      try {
        await ensurePassiveReconPlan(engagementId);
        await handleLoadCompliance(engagementId);
        await loadReportForEngagement(engagementId, true);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Failed to load technical report."
        );
      }
    }
  }

  async function handleDownloadReport(engagementId: string) {
    if (!session) {
      return;
    }

    setDownloadingById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const report = await loadReportForEngagement(engagementId, true);
      if (!report) {
        throw new Error("No report data available for this engagement.");
      }

      const viewMode = viewModeByEngagement[engagementId] || "summary";
      await downloadEngagementReport(report, {
        format: "markdown",
        viewMode
      });
      setMessage("Report downloaded successfully.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to download report."
      );
    } finally {
      setDownloadingById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleDownloadBackendPdf(engagementId: string) {
    if (!session) {
      return;
    }

    setDownloadingBackendPdfById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const blob = await downloadBackendPdfReport(session, engagementId);
      const engagementName =
        engagements.find((item) => item._id === engagementId)?.name ||
        "venom-engagement-report";
      const safeName = engagementName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      triggerBlobDownload(blob, `${safeName || "venom-engagement"}-${engagementId}.pdf`);
      setMessage("Backend PDF report downloaded successfully.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to download backend PDF report."
      );
    } finally {
      setDownloadingBackendPdfById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleEmailReport(engagementId: string) {
    if (!session) {
      return;
    }

    const recipientEmail = window.prompt(
      "Send report PDF to email address:",
      session.email
    );
    if (!recipientEmail) {
      return;
    }

    setEmailingReportById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const result = await emailBackendReport(session, engagementId, recipientEmail);
      setMessage(`Report email sent to ${result.to}.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to send report email."
      );
    } finally {
      setEmailingReportById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleDecommissionEngagement(engagementId: string) {
    if (!session) {
      return;
    }

    setDeletingById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const result = await deleteEngagement(session, engagementId);
      setConfirmDeleteId(null);
      setLatestPlanByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setLatestExecutionByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setTopMatchByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setLearningSummaryByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setReportByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setComplianceByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setViewModeByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setMessage(
        `Engagement removed. Deleted ${result.plansDeleted} plan(s) and ${result.executionJobsDeleted} execution job(s).`
      );
      await loadEngagementData(session, false);
      await loadWeek7Telemetry(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to remove engagement."
      );
    } finally {
      setDeletingById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  if (!sessionReady) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="rounded-3xl border border-white/40 bg-white/80 px-6 py-4 shadow-lg backdrop-blur">
          <p className="text-sm font-medium text-slate-700">
            Verifying secure session...
          </p>
        </div>
      </main>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <main className="relative mx-auto w-full max-w-7xl px-4 py-8 lg:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 rounded-b-[3rem] bg-gradient-to-r from-emerald-100/60 via-white/70 to-cyan-100/50 blur-2xl" />
      <header className="mb-8 rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.14)] backdrop-blur-xl lg:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-strong">
              VENOM Security Dashboard
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-foreground">
              Engagement Control Center
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Logged in as {session.email} ({session.role})
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadEngagementData(session, true)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-px hover:bg-slate-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-xl bg-gradient-to-r from-slate-800 to-slate-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:-translate-y-px"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-600">Total</p>
            <p className="text-2xl font-semibold">{summary.total}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-600">Running</p>
            <p className="text-2xl font-semibold">{summary.running}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-600">Draft</p>
            <p className="text-2xl font-semibold">{summary.draft}</p>
          </article>
        </div>
      </header>

      <section className="mb-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <article className="rounded-3xl border border-white/70 bg-white/85 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.10)] backdrop-blur-sm">
          <h2 className="text-lg font-semibold">Week 7 Metrics</h2>
          <p className="mb-4 text-sm text-slate-600">
            Live performance and learning telemetry
          </p>
          {metricsOverview ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">
                    Success Rate
                  </p>
                  <p className="text-2xl font-semibold">
                    {(metricsOverview.jobSummary.successRate * 100).toFixed(1)}%
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">
                    Findings
                  </p>
                  <p className="text-2xl font-semibold">
                    {metricsOverview.jobSummary.findingsCount}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">
                    Avg Duration
                  </p>
                  <p className="text-2xl font-semibold">
                    {metricsOverview.jobSummary.avgDurationSeconds}s
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">
                    Est. Cost
                  </p>
                  <p className="text-2xl font-semibold">
                    ${metricsOverview.jobSummary.totalCostUsd.toFixed(2)}
                  </p>
                </article>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Week-over-week delta:{" "}
                <span className="font-medium">
                  {(metricsOverview.weekOverWeek.delta * 100).toFixed(1)}%
                </span>
              </p>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Week 8 Threat Intel
                    </p>
                    <p className="text-sm text-slate-600">
                      NVD/CVE feed snapshot used by planning context
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSyncCveFeed()}
                    disabled={syncingCves}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {syncingCves ? "Syncing..." : "Sync CVE Feed"}
                  </button>
                </div>
                {cveSummary ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <article className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">Total</p>
                      <p className="text-lg font-semibold">{cveSummary.total}</p>
                    </article>
                    <article className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        Critical
                      </p>
                      <p className="text-lg font-semibold">{cveSummary.critical}</p>
                    </article>
                    <article className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">High</p>
                      <p className="text-lg font-semibold">{cveSummary.high}</p>
                    </article>
                    <article className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">
                        KEV/Exploit
                      </p>
                      <p className="text-lg font-semibold">{cveSummary.withExploit}</p>
                    </article>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Threat-intel summary unavailable.
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  Last update: {cveSummary?.lastUpdatedAt ? formatDate(cveSummary.lastUpdatedAt) : "n/a"}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Telemetry not available yet.</p>
          )}
        </article>

        <article className="rounded-3xl border border-white/70 bg-white/85 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.10)] backdrop-blur-sm">
          <h2 className="text-lg font-semibold">Alerts</h2>
          <p className="mb-4 text-sm text-slate-600">
            Automated health and budget warnings
          </p>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-500">No active alerts.</p>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => {
                const severityStyle =
                  alert.severity === "critical"
                    ? "border-rose-400 bg-rose-50"
                    : alert.severity === "high"
                    ? "border-rose-300 bg-rose-50/80"
                    : alert.severity === "medium"
                    ? "border-amber-300 bg-amber-50/80"
                    : "border-slate-200 bg-white";

                return (
                  <article
                    key={alert.id}
                    className={`rounded-xl border px-3 py-2 ${severityStyle}`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {alert.severity}
                    </p>
                    <p className="font-medium">{alert.title}</p>
                    <p className="text-sm text-slate-600">{alert.message}</p>
                  </article>
                );
              })}
            </div>
          )}
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <article className="rounded-3xl border border-white/70 bg-white/85 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.10)] backdrop-blur-sm">
          <h2 className="text-lg font-semibold">Engagements</h2>
          <p className="mb-4 text-sm text-slate-600">
            Latest tests from the VENOM backend
          </p>

          {loading ? (
            <p className="text-sm text-slate-500">Loading engagements...</p>
          ) : engagements.length === 0 ? (
            <p className="text-sm text-slate-500">No engagements yet.</p>
          ) : (
            <div className="space-y-3">
              {engagements.map((engagement) => {
                const viewMode = viewModeByEngagement[engagement._id] || "summary";
                const technicalViewEnabled = viewMode === "detailed";
                const report = reportByEngagement[engagement._id];
                const latestPlan =
                  report?.latestPlan || latestPlanByEngagement[engagement._id] || null;
                const latestExecution =
                  report?.latestExecutionJob ||
                  latestExecutionByEngagement[engagement._id] ||
                  null;
                const topPatterns = report?.patternMatches?.slice(0, 3) || [];
                const headersProbeJob =
                  report?.executionJobs?.find(
                    (job) => job.toolId === "http_headers_probe"
                  ) || null;
                const dnsProbeJob =
                  report?.executionJobs?.find(
                    (job) => job.toolId === "dns_lookup_probe"
                  ) || null;
                const tlsProbeJob =
                  report?.executionJobs?.find(
                    (job) => job.toolId === "tls_metadata_probe"
                  ) || null;
                const compliance =
                  complianceByEngagement[engagement._id] || null;

                return (
                  <article
                    key={engagement._id}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-foreground">
                          {engagement.name}
                        </p>
                        <p className="text-sm text-slate-600">
                          {engagement.targetUrl}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDate(engagement.createdAt)}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase">
                        {engagement.status}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Deep-Dive
                        </p>
                        <p className="text-xs text-slate-600">
                          Toggle technical report mode
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-600">
                          {technicalViewEnabled ? "Technical" : "Executive"}
                        </span>
                        <Switch
                          checked={technicalViewEnabled}
                          onCheckedChange={(checked) =>
                            void handleViewModeToggle(engagement._id, checked)
                          }
                          aria-label={`Toggle technical report mode for ${engagement.name}`}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleGeneratePlan(engagement._id)}
                        disabled={Boolean(planningById[engagement._id])}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {planningById[engagement._id]
                          ? "Generating..."
                          : "Generate Plan"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLoadLatestPlan(engagement._id)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        View Latest Plan
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRunHeadersProbe(engagement._id)}
                        disabled={Boolean(executingById[engagement._id])}
                        className="rounded-lg border border-accent/40 bg-white px-3 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {executingById[engagement._id]
                          ? "Running Probe..."
                          : "Run Headers Probe"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLoadLatestExecution(engagement._id)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        View Latest Probe
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownloadReport(engagement._id)}
                        disabled={Boolean(downloadingById[engagement._id])}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <DownloadIcon />
                        <span>
                          {downloadingById[engagement._id]
                            ? "Downloading..."
                            : "Download Report"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDownloadBackendPdf(engagement._id)}
                        disabled={Boolean(downloadingBackendPdfById[engagement._id])}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <DownloadIcon />
                        <span>
                          {downloadingBackendPdfById[engagement._id]
                            ? "Preparing PDF..."
                            : "Download Backend PDF"}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleEmailReport(engagement._id)}
                        disabled={Boolean(emailingReportById[engagement._id])}
                        className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {emailingReportById[engagement._id]
                          ? "Emailing..."
                          : "Email PDF Report"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleLoadCompliance(engagement._id)}
                        disabled={Boolean(complianceLoadingById[engagement._id])}
                        className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {complianceLoadingById[engagement._id]
                          ? "Loading Compliance..."
                          : "Load Compliance"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMatchPatterns(engagement._id)}
                        disabled={Boolean(matchingById[engagement._id])}
                        className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {matchingById[engagement._id]
                          ? "Matching..."
                          : "Match Patterns"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRunLearning(engagement._id)}
                        disabled={Boolean(learningById[engagement._id])}
                        className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {learningById[engagement._id]
                          ? "Learning..."
                          : "Run Learning"}
                      </button>
                      {technicalViewEnabled ? (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(engagement._id)}
                          disabled={Boolean(deletingById[engagement._id])}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          <TrashIcon />
                          <span>
                            {deletingById[engagement._id]
                              ? "Removing..."
                              : "Decommission"}
                          </span>
                        </button>
                      ) : null}
                    </div>

                    {technicalViewEnabled ? (
                      <div className="mt-3 w-full max-w-full space-y-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-950/95 p-3 text-xs text-slate-100">
                        <p className="font-semibold uppercase tracking-wide text-slate-300">
                          Forensic View
                        </p>
                        {topPatterns.length > 0 ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Pattern Match Scores
                            </p>
                            <ul className="mt-1 space-y-1">
                              {topPatterns.map((item) => (
                                <li key={item.patternId}>
                                  {item.patternName} | score=
                                  {item.applicabilityScore.toFixed(2)} | confidence=
                                  {item.confidence.toFixed(2)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-slate-400">
                            No pattern scores loaded yet. Run &quot;Match Patterns&quot; or
                            download
                            the report.
                          </p>
                        )}

                        {compliance ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Compliance Snapshot
                            </p>
                            <p className="mt-1 text-slate-200">
                              CVSS {compliance.cvssOverallScore.toFixed(2)} (
                              {compliance.cvssSeverity}) | OWASP categories{" "}
                              {compliance.owaspCoverage} | Rating {compliance.owaspRating}
                            </p>
                          </div>
                        ) : (
                          <p className="text-slate-400">
                            Compliance snapshot unavailable. Run &quot;Load Compliance&quot;.
                          </p>
                        )}

                        {latestExecution ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Latest Execution Metadata
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(latestExecution, null, 2)}
                            </pre>
                          </div>
                        ) : (
                          <p className="text-slate-400">
                            No execution metadata available yet.
                          </p>
                        )}

                        {headersProbeJob?.output ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              HTTP Response Body + Header Forensics
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(headersProbeJob.output, null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        {dnsProbeJob?.output ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              DNS Record Forensics
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(dnsProbeJob.output, null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        {tlsProbeJob?.output ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              SSL/TLS Certificate Chain Forensics
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(tlsProbeJob.output, null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        {latestPlan ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Latest Plan Metadata
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(latestPlan, null, 2)}
                            </pre>
                          </div>
                        ) : (
                          <p className="text-slate-400">No plan metadata available yet.</p>
                        )}
                      </div>
                    ) : (
                      <>
                        {report?.summary ? (
                          <p className="mt-2 text-xs text-slate-600">
                            Executive metrics:{" "}
                            <span className="font-medium">
                              Success {(report.summary.successRate * 100).toFixed(1)}%,
                              jobs {report.summary.totalExecutionJobs}, plans{" "}
                              {report.summary.totalPlans}
                            </span>
                          </p>
                        ) : null}
                        {latestPlan ? (
                          <p className="mt-2 text-xs text-slate-600">
                            Latest plan:{" "}
                            <span className="font-medium">{latestPlan.summary}</span>
                          </p>
                        ) : null}
                        {latestExecution ? (
                          <p className="mt-1 text-xs text-slate-600">
                            Latest probe:{" "}
                            <span className="font-medium">{latestExecution.toolId}</span>{" "}
                            {"->"}{" "}
                            <span className="font-medium uppercase">
                              {latestExecution.status}
                            </span>
                          </p>
                        ) : null}
                        {topMatchByEngagement[engagement._id] ? (
                          <p className="mt-1 text-xs text-slate-600">
                            Top match:{" "}
                            <span className="font-medium">
                              {topMatchByEngagement[engagement._id]?.name}
                            </span>{" "}
                            ({topMatchByEngagement[engagement._id]?.score.toFixed(2)})
                          </p>
                        ) : null}
                        {compliance ? (
                          <p className="mt-1 text-xs text-slate-600">
                            Compliance:{" "}
                            <span className="font-medium">
                              CVSS {compliance.cvssOverallScore.toFixed(2)} (
                              {compliance.cvssSeverity})
                            </span>{" "}
                            | OWASP {compliance.owaspCoverage} categories |{" "}
                            <span className="font-medium">{compliance.owaspRating}</span>
                          </p>
                        ) : null}
                        {learningSummaryByEngagement[engagement._id] ? (
                          <p className="mt-1 text-xs text-slate-600">
                            Learning:{" "}
                            <span className="font-medium">
                              {learningSummaryByEngagement[engagement._id]}
                            </span>
                          </p>
                        ) : null}
                      </>
                    )}

                    {progressByEngagement[engagement._id] ? (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                          <span>
                            Progress:{" "}
                            {progressByEngagement[engagement._id].currentPhase}
                          </span>
                          <span>
                            {progressByEngagement[engagement._id].progressPercent}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{
                              width: `${progressByEngagement[engagement._id].progressPercent}%`
                            }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </article>

        <article className="rounded-3xl border border-white/70 bg-white/85 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.10)] backdrop-blur-sm">
          <h2 className="text-lg font-semibold">New Engagement</h2>
          <p className="mb-4 text-sm text-slate-600">
            Create and queue a new authorized target
          </p>

          <form className="space-y-3" onSubmit={handleCreate}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Name</span>
              <input
                required
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Acme staging baseline"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Target URL</span>
              <input
                required
                type="url"
                value={form.targetUrl}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, targetUrl: event.target.value }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="https://staging.example.com"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Type</span>
              <select
                value={form.targetType}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    targetType: event.target.value as CreateEngagementInput["targetType"]
                  }))
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                <option value="website">Website</option>
                <option value="api">API</option>
                <option value="network">Network</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Description</span>
              <textarea
                rows={4}
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value
                  }))
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="Scope notes, objective, and context"
              />
            </label>

            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {message ? <p className="text-sm text-accent">{message}</p> : null}

            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-xl bg-accent px-4 py-2 font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {creating ? "Creating..." : "Create Engagement"}
            </button>
          </form>
        </article>
      </section>

      {engagementPendingDelete ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Confirm Decommission
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              Remove engagement{" "}
              <span className="font-semibold text-slate-900">
                {engagementPendingDelete.name}
              </span>
              ? This will permanently delete associated plans and execution jobs.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleDecommissionEngagement(engagementPendingDelete._id)
                }
                disabled={Boolean(deletingById[engagementPendingDelete._id])}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deletingById[engagementPendingDelete._id]
                  ? "Removing..."
                  : "Remove Task"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
