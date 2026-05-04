"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createEngagement,
  runAssessmentChain,
  evolvePromptsNow,
  fetchOrchestratorStatus,
  fetchPromptActive,
  fetchPromptHistory,
  orchestrateSingleEngagement,
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
  verifyEvidenceChain,
  type AlertItem,
  type ChainRunResponse,
  type CveSummary,
  type ComplianceSummary,
  type CreateEngagementInput,
  type EvidenceVerifyResponse,
  type Engagement,
  type EngagementReport,
  type EngagementProgress,
  type ExecutionJob,
  type MetricsOverview,
  type OrchestratorStatusResponse,
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

function getStatusBadgeTone(status: Engagement["status"]) {
  switch (status) {
    case "running":
      return "border-lime-400/35 bg-lime-500/10 text-lime-200";
    case "completed":
      return "border-cyan-400/35 bg-cyan-500/10 text-cyan-200";
    case "failed":
      return "border-rose-400/35 bg-rose-500/10 text-rose-200";
    case "paused":
      return "border-amber-400/35 bg-amber-500/10 text-amber-200";
    default:
      return "border-slate-600 bg-slate-800/70 text-slate-200";
  }
}

function getAlertTone(severity: AlertItem["severity"]) {
  switch (severity) {
    case "critical":
      return "border-rose-500/60 bg-rose-500/10";
    case "high":
      return "border-orange-500/55 bg-orange-500/10";
    case "medium":
      return "border-amber-500/50 bg-amber-500/10";
    default:
      return "border-cyan-500/45 bg-cyan-500/10";
  }
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
  const [chainRunningById, setChainRunningById] = useState<Record<string, boolean>>(
    {}
  );
  const [chainSummaryByEngagement, setChainSummaryByEngagement] = useState<
    Record<string, ChainRunResponse | null>
  >({});
  const [evidenceStatusByEngagement, setEvidenceStatusByEngagement] = useState<
    Record<string, EvidenceVerifyResponse | null>
  >({});
  const [evidenceLoadingById, setEvidenceLoadingById] = useState<
    Record<string, boolean>
  >({});
  const [evolvingPrompts, setEvolvingPrompts] = useState(false);
  const [orchestratingById, setOrchestratingById] = useState<Record<string, boolean>>(
    {}
  );
  const [orchestratorStatus, setOrchestratorStatus] =
    useState<OrchestratorStatusResponse | null>(null);
  const [activePromptCount, setActivePromptCount] = useState(0);
  const [latestPromptVersion, setLatestPromptVersion] = useState<string | null>(null);
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

  async function loadWeek11ControlPlane(activeSession: VenomSession) {
    try {
      const [orchestrator, promptActive, promptHistory] = await Promise.all([
        fetchOrchestratorStatus(activeSession),
        fetchPromptActive(activeSession),
        fetchPromptHistory(activeSession, undefined, 5)
      ]);

      setOrchestratorStatus(orchestrator);
      setActivePromptCount(promptActive.active.length);
      setLatestPromptVersion(promptHistory.history[0]?.version || null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load Week 11 control plane state."
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
      await loadWeek11ControlPlane(session);
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

  async function handleRunPromptEvolution() {
    if (!session) {
      return;
    }

    setEvolvingPrompts(true);
    setError("");
    setMessage("");

    try {
      const result = await evolvePromptsNow(session, ["planning", "chain", "learning"]);
      setMessage(
        `Prompt evolution complete: ${result.evolvedCount} evolved, ${result.skippedCount} skipped.`
      );
      await loadWeek11ControlPlane(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to run prompt evolution."
      );
    } finally {
      setEvolvingPrompts(false);
    }
  }

  async function handleAutonomousRun(engagementId: string) {
    if (!session) {
      return;
    }

    setOrchestratingById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const result = await orchestrateSingleEngagement(session, engagementId);
      setMessage(
        `Autonomous run completed (${result.executionResults.length} tool steps, planner=${result.plannerSource}).`
      );
      await loadEngagementData(session, false);
      await loadWeek7Telemetry(session);
      await loadWeek11ControlPlane(session);
      await loadReportForEngagement(engagementId, true);
      await handleLoadCompliance(engagementId);
      await handleVerifyEvidence(engagementId);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to run autonomous orchestration."
      );
    } finally {
      setOrchestratingById((prev) => ({ ...prev, [engagementId]: false }));
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
          await loadWeek11ControlPlane(session);
          await loadWeek11ControlPlane(session);
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
      void loadWeek11ControlPlane(session);
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
      await loadWeek11ControlPlane(session);
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
  const alertSeverityCounts = useMemo(() => {
    return alerts.reduce(
      (acc, alert) => {
        acc.total += 1;
        acc[alert.severity] += 1;
        return acc;
      },
      { total: 0, critical: 0, high: 0, medium: 0, low: 0 }
    );
  }, [alerts]);
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
      await loadWeek11ControlPlane(session);
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

  async function handleRunTool(engagementId: string, toolId: string, label: string) {
    if (!session) {
      return;
    }

    setExecutingById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const job = await runExecutionJob(session, engagementId, toolId);
      setLatestExecutionByEngagement((prev) => ({
        ...prev,
        [engagementId]: job
      }));
      setMessage(`${label} completed (${job.status.toUpperCase()}).`);
      await loadReportForEngagement(engagementId, true);
      await loadWeek7Telemetry(session);
      await loadWeek11ControlPlane(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : `Failed to execute ${label}.`
      );
    } finally {
      setExecutingById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleRunHeadersProbe(engagementId: string) {
    await handleRunTool(engagementId, "http_headers_probe", "Headers probe");
  }

  async function handleRunWeek10Tool(
    engagementId: string,
    toolId: "nmap_tcp_scan" | "nuclei_scan" | "nikto_scan" | "sqlmap_detect"
  ) {
    const labels = {
      nmap_tcp_scan: "Nmap TCP scan",
      nuclei_scan: "Nuclei scan",
      nikto_scan: "Nikto scan",
      sqlmap_detect: "SQLMap detect"
    } as const;
    await handleRunTool(engagementId, toolId, labels[toolId]);
  }

  async function handleRunWeek10Chain(engagementId: string) {
    if (!session) {
      return;
    }

    setChainRunningById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const result = await runAssessmentChain(session, engagementId);
      setChainSummaryByEngagement((prev) => ({
        ...prev,
        [engagementId]: result
      }));
      setMessage(
        `Week 10 chain executed: ${result.stepsExecuted}/${result.stepsPlanned} step(s) via ${result.source} planner.`
      );
      await loadReportForEngagement(engagementId, true);
      await loadWeek7Telemetry(session);
      await loadWeek11ControlPlane(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to run Week 10 chain."
      );
    } finally {
      setChainRunningById((prev) => ({ ...prev, [engagementId]: false }));
    }
  }

  async function handleVerifyEvidence(engagementId: string) {
    if (!session) {
      return;
    }

    setEvidenceLoadingById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");

    try {
      const result = await verifyEvidenceChain(session, engagementId);
      setEvidenceStatusByEngagement((prev) => ({
        ...prev,
        [engagementId]: result
      }));
      setMessage(
        result.valid
          ? `Evidence chain verified (${result.totalItems} item(s)).`
          : `Evidence chain mismatch at index ${result.brokenAt || "unknown"}.`
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to verify evidence chain."
      );
    } finally {
      setEvidenceLoadingById((prev) => ({ ...prev, [engagementId]: false }));
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
      await loadWeek11ControlPlane(session);
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
        await handleVerifyEvidence(engagementId);
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

    const normalizedEmail = recipientEmail.trim();
    const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!emailLooksValid) {
      setError("Enter a valid recipient email address.");
      return;
    }

    setEmailingReportById((prev) => ({ ...prev, [engagementId]: true }));
    setError("");
    setMessage("");

    try {
      const result = await emailBackendReport(session, engagementId, normalizedEmail);
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
      setChainSummaryByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setEvidenceStatusByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setViewModeByEngagement((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setOrchestratingById((prev) => {
        const next = { ...prev };
        delete next[engagementId];
        return next;
      });
      setMessage(
        `Engagement removed. Deleted ${result.plansDeleted} plan(s), ${result.executionJobsDeleted} execution job(s), and ${result.evidenceDeleted ?? 0} evidence item(s).`
      );
      await loadEngagementData(session, false);
      await loadWeek7Telemetry(session);
      await loadWeek11ControlPlane(session);
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
      <main className="flex min-h-screen items-center justify-center bg-[#07090d] px-6">
        <div className="rounded-3xl border border-slate-700 bg-slate-900/85 px-6 py-4 shadow-lg backdrop-blur">
          <p className="text-sm font-medium text-slate-200">
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
    <main className="relative mx-auto min-h-screen w-full max-w-[1440px] px-4 py-6 text-slate-100 lg:px-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 rounded-b-[3rem] bg-[radial-gradient(circle_at_15%_20%,rgba(209,255,0,0.14),transparent_35%),radial-gradient(circle_at_86%_5%,rgba(255,62,62,0.12),transparent_30%),linear-gradient(180deg,#060708_0%,#0a0d12_68%,#0b0f14_100%)]" />
      <header className="mb-6 rounded-[28px] border border-slate-800 bg-[#0f1319]/95 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lime-300">
              VENOM Security Dashboard
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-100">
              Engagement Control Center
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Logged in as {session.email} ({session.role})
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadEngagementData(session, true)}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:-translate-y-px hover:bg-slate-800"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-xl bg-gradient-to-r from-slate-700 to-slate-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:-translate-y-px"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-lime-500/40 bg-lime-500/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-lime-200/85">Total</p>
            <p className="text-2xl font-semibold text-lime-100">{summary.total}</p>
          </article>
          <article className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-cyan-100/80">Running</p>
            <p className="text-2xl font-semibold text-cyan-100">{summary.running}</p>
          </article>
          <article className="rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-300">Draft</p>
            <p className="text-2xl font-semibold text-slate-100">{summary.draft}</p>
          </article>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-rose-500/45 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mt-4 rounded-xl border border-lime-500/45 bg-lime-500/10 px-3 py-2 text-sm text-lime-200">
            {message}
          </p>
        ) : null}
      </header>

      <section className="mb-6 grid items-start gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-3xl border border-slate-800 bg-[#11161d]/95 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-slate-100">Week 7 Metrics</h2>
          <p className="mb-4 text-sm text-slate-400">
            Live performance and learning telemetry
          </p>
          {metricsOverview ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <article className="rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Success Rate
                  </p>
                  <p className="text-2xl font-semibold text-lime-200">
                    {(metricsOverview.jobSummary.successRate * 100).toFixed(1)}%
                  </p>
                </article>
                <article className="rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Findings
                  </p>
                  <p className="text-2xl font-semibold text-cyan-200">
                    {metricsOverview.jobSummary.findingsCount}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Avg Duration
                  </p>
                  <p className="text-2xl font-semibold text-slate-100">
                    {metricsOverview.jobSummary.avgDurationSeconds}s
                  </p>
                </article>
                <article className="rounded-xl border border-slate-700 bg-slate-900/85 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Est. Cost
                  </p>
                  <p className="text-2xl font-semibold text-amber-200">
                    ${metricsOverview.jobSummary.totalCostUsd.toFixed(2)}
                  </p>
                </article>
              </div>
              <p className="mt-3 text-sm text-slate-300">
                Week-over-week delta:{" "}
                <span className="font-medium">
                  {(metricsOverview.weekOverWeek.delta * 100).toFixed(1)}%
                </span>
              </p>

              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Week 8 Threat Intel
                    </p>
                    <p className="text-sm text-slate-300">
                      NVD/CVE feed snapshot used by planning context
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSyncCveFeed()}
                    disabled={syncingCves}
                    className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {syncingCves ? "Syncing..." : "Sync CVE Feed"}
                  </button>
                </div>
                {cveSummary ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <article className="rounded-lg border border-slate-700 bg-slate-900/75 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-400">Total</p>
                      <p className="text-lg font-semibold text-slate-100">{cveSummary.total}</p>
                    </article>
                    <article className="rounded-lg border border-rose-500/45 bg-rose-500/10 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-rose-200/90">
                        Critical
                      </p>
                      <p className="text-lg font-semibold text-rose-200">{cveSummary.critical}</p>
                    </article>
                    <article className="rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-amber-200/90">High</p>
                      <p className="text-lg font-semibold text-amber-200">{cveSummary.high}</p>
                    </article>
                    <article className="rounded-lg border border-cyan-500/45 bg-cyan-500/10 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-cyan-200/90">
                        KEV/Exploit
                      </p>
                      <p className="text-lg font-semibold text-cyan-200">{cveSummary.withExploit}</p>
                    </article>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">
                    Threat-intel summary unavailable.
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  Last update: {cveSummary?.lastUpdatedAt ? formatDate(cveSummary.lastUpdatedAt) : "n/a"}
                </p>
              </div>

              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Week 11 Autonomy Control Plane
                    </p>
                    <p className="text-sm text-slate-300">
                      Prompt evolution and multi-target orchestration status
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void loadWeek11ControlPlane(session)}
                      className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                    >
                      Refresh Week 11
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRunPromptEvolution()}
                      disabled={evolvingPrompts}
                      className="rounded-lg border border-violet-500/45 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {evolvingPrompts ? "Evolving..." : "Run Prompt Evolution"}
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <article className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Active Prompts
                    </p>
                    <p className="text-lg font-semibold text-slate-100">{activePromptCount}</p>
                  </article>
                  <article className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Orchestrations Active
                    </p>
                    <p className="text-lg font-semibold text-slate-100">
                      {orchestratorStatus?.activeCount ?? 0} /{" "}
                      {orchestratorStatus?.maxConcurrent ?? 0}
                    </p>
                  </article>
                  <article className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">
                      Latest Prompt
                    </p>
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {latestPromptVersion || "n/a"}
                    </p>
                  </article>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">Telemetry not available yet.</p>
          )}
        </article>

        <article className="rounded-3xl border border-slate-800 bg-[#11161d]/95 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-slate-100">Alerts</h2>
          <p className="mb-4 text-sm text-slate-400">
            Automated health and budget warnings
          </p>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <article className="rounded-lg border border-slate-700 bg-slate-900/75 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Total</p>
              <p className="text-base font-semibold text-slate-100">{alertSeverityCounts.total}</p>
            </article>
            <article className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-rose-200/90">Critical</p>
              <p className="text-base font-semibold text-rose-200">{alertSeverityCounts.critical}</p>
            </article>
            <article className="rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-orange-200/90">High</p>
              <p className="text-base font-semibold text-orange-200">{alertSeverityCounts.high}</p>
            </article>
            <article className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-amber-200/90">Medium</p>
              <p className="text-base font-semibold text-amber-200">{alertSeverityCounts.medium}</p>
            </article>
          </div>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-400">No active alerts.</p>
          ) : (
            <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
              {alerts.map((alert) => {
                return (
                  <article
                    key={alert.id}
                    className={`rounded-xl border px-3 py-2 ${getAlertTone(alert.severity)}`}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      {alert.severity}
                    </p>
                    <p className="font-medium text-slate-100">{alert.title}</p>
                    <p className="text-sm text-slate-300">{alert.message}</p>
                  </article>
                );
              })}
            </div>
          )}
        </article>
      </section>

      <section className="grid items-start gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <article className="rounded-3xl border border-slate-800 bg-[#11161d]/95 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-sm">
          <h2 className="text-lg font-semibold text-slate-100">Engagements</h2>
          <p className="mb-4 text-sm text-slate-400">
            Latest tests from the VENOM backend
          </p>

          {loading ? (
            <p className="text-sm text-slate-400">Loading engagements...</p>
          ) : engagements.length === 0 ? (
            <p className="text-sm text-slate-400">No engagements yet.</p>
          ) : (
            <div className="max-h-[74vh] space-y-3 overflow-y-auto pr-1">
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
                const nmapJob =
                  report?.executionJobs?.find((job) => job.toolId === "nmap_tcp_scan") ||
                  null;
                const nucleiJob =
                  report?.executionJobs?.find((job) => job.toolId === "nuclei_scan") ||
                  null;
                const niktoJob =
                  report?.executionJobs?.find((job) => job.toolId === "nikto_scan") ||
                  null;
                const sqlmapJob =
                  report?.executionJobs?.find((job) => job.toolId === "sqlmap_detect") ||
                  null;
                const compliance =
                  complianceByEngagement[engagement._id] || null;
                const chainSummary = chainSummaryByEngagement[engagement._id] || null;
                const evidenceStatus = evidenceStatusByEngagement[engagement._id] || null;

                return (
                  <article
                    key={engagement._id}
                    className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-100">
                          {engagement.name}
                        </p>
                        <p className="text-sm text-slate-300">
                          {engagement.targetUrl}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDate(engagement.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-semibold uppercase ${getStatusBadgeTone(
                          engagement.status
                        )}`}
                      >
                        {engagement.status}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Deep-Dive
                        </p>
                        <p className="text-xs text-slate-300">
                          Toggle technical report mode
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-300">
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

                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <button
                        type="button"
                        onClick={() => void handleGeneratePlan(engagement._id)}
                        disabled={Boolean(planningById[engagement._id])}
                        className="rounded-lg bg-lime-500/90 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {planningById[engagement._id]
                          ? "Generating..."
                          : "Generate Plan"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRunHeadersProbe(engagement._id)}
                        disabled={Boolean(executingById[engagement._id])}
                        className="rounded-lg border border-cyan-500/45 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {executingById[engagement._id]
                          ? "Running Probe..."
                          : "Run Headers Probe"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRunWeek10Chain(engagement._id)}
                        disabled={Boolean(chainRunningById[engagement._id])}
                        className="rounded-lg border border-fuchsia-500/45 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {chainRunningById[engagement._id]
                          ? "Running Chain..."
                          : "Run Week 10 Chain"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAutonomousRun(engagement._id)}
                        disabled={Boolean(orchestratingById[engagement._id])}
                        className="rounded-lg border border-violet-500/45 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {orchestratingById[engagement._id]
                          ? "Autonomous Run..."
                          : "Autonomous Run"}
                      </button>
                    </div>

                    <details className="group mt-2 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-300 marker:content-none">
                        <span>Advanced Actions</span>
                        <span className="text-[10px] text-slate-500 group-open:hidden">
                          Expand
                        </span>
                        <span className="hidden text-[10px] text-slate-500 group-open:inline">
                          Collapse
                        </span>
                      </summary>

                      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => void handleLoadLatestPlan(engagement._id)}
                          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                        >
                          View Latest Plan
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLoadLatestExecution(engagement._id)}
                          className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                        >
                          View Latest Probe
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLoadCompliance(engagement._id)}
                          disabled={Boolean(complianceLoadingById[engagement._id])}
                          className="rounded-lg border border-indigo-500/45 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {complianceLoadingById[engagement._id]
                            ? "Loading Compliance..."
                            : "Load Compliance"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleMatchPatterns(engagement._id)}
                          disabled={Boolean(matchingById[engagement._id])}
                          className="rounded-lg border border-sky-500/45 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {matchingById[engagement._id]
                            ? "Matching..."
                            : "Match Patterns"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRunLearning(engagement._id)}
                          disabled={Boolean(learningById[engagement._id])}
                          className="rounded-lg border border-emerald-500/45 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {learningById[engagement._id]
                            ? "Learning..."
                            : "Run Learning"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleVerifyEvidence(engagement._id)}
                          disabled={Boolean(evidenceLoadingById[engagement._id])}
                          className="rounded-lg border border-cyan-500/45 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {evidenceLoadingById[engagement._id]
                            ? "Verifying..."
                            : "Verify Evidence"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleRunWeek10Tool(engagement._id, "nmap_tcp_scan")
                          }
                          disabled={Boolean(executingById[engagement._id])}
                          className="rounded-lg border border-amber-500/45 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {executingById[engagement._id] ? "Running..." : "Run Nmap TCP"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleRunWeek10Tool(engagement._id, "nuclei_scan")
                          }
                          disabled={Boolean(executingById[engagement._id])}
                          className="rounded-lg border border-orange-500/45 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold text-orange-200 transition hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {executingById[engagement._id] ? "Running..." : "Run Nuclei"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleRunWeek10Tool(engagement._id, "nikto_scan")
                          }
                          disabled={Boolean(executingById[engagement._id])}
                          className="rounded-lg border border-lime-500/45 bg-lime-500/10 px-3 py-1.5 text-xs font-semibold text-lime-200 transition hover:bg-lime-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {executingById[engagement._id] ? "Running..." : "Run Nikto"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleRunWeek10Tool(engagement._id, "sqlmap_detect")
                          }
                          disabled={Boolean(executingById[engagement._id])}
                          className="rounded-lg border border-rose-500/45 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {executingById[engagement._id] ? "Running..." : "Run SQLMap Detect"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDownloadReport(engagement._id)}
                          disabled={Boolean(downloadingById[engagement._id])}
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
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
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
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
                          className="rounded-lg border border-violet-500/45 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {emailingReportById[engagement._id]
                            ? "Emailing..."
                            : "Email PDF Report"}
                        </button>
                        {technicalViewEnabled ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(engagement._id)}
                            disabled={Boolean(deletingById[engagement._id])}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-500/45 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-70"
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
                    </details>

                    {technicalViewEnabled ? (
                      <div className="mt-3 w-full max-w-full space-y-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-950/95 p-3 text-xs text-slate-100">
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

                        {chainSummary ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Week 10 Chain Status
                            </p>
                            <p className="mt-1 text-slate-200">
                              Source {chainSummary.source} | Executed{" "}
                              {chainSummary.stepsExecuted}/{chainSummary.stepsPlanned}
                              {chainSummary.haltedAt
                                ? ` | Halted at step ${chainSummary.haltedAt.step} (${chainSummary.haltedAt.reason})`
                                : ""}
                            </p>
                          </div>
                        ) : (
                          <p className="text-slate-400">
                            Week 10 chain has not been run yet.
                          </p>
                        )}

                        {evidenceStatus ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Evidence Chain of Custody
                            </p>
                            <p className="mt-1 text-slate-200">
                              Integrity {evidenceStatus.valid ? "VALID" : "BROKEN"} | Items{" "}
                              {evidenceStatus.totalItems}
                              {evidenceStatus.brokenAt
                                ? ` | Broken at ${evidenceStatus.brokenAt}`
                                : ""}
                            </p>
                          </div>
                        ) : (
                          <p className="text-slate-400">
                            Evidence chain not verified yet.
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

                        {nmapJob?.output ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Nmap TCP Scan Output
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(nmapJob.output, null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        {nucleiJob?.output ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Nuclei Scan Output
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(nucleiJob.output, null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        {niktoJob?.output ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              Nikto Scan Output
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(niktoJob.output, null, 2)}
                            </pre>
                          </div>
                        ) : null}

                        {sqlmapJob?.output ? (
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">
                              SQLMap Detection Output
                            </p>
                            <pre className="mt-1 max-h-56 w-full max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border border-slate-800 bg-slate-900 p-2">
                              {JSON.stringify(sqlmapJob.output, null, 2)}
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
                          <p className="mt-2 text-xs text-slate-300">
                            Executive metrics:{" "}
                            <span className="font-medium">
                              Success {(report.summary.successRate * 100).toFixed(1)}%,
                              jobs {report.summary.totalExecutionJobs}, plans{" "}
                              {report.summary.totalPlans}
                            </span>
                          </p>
                        ) : null}
                        {latestPlan ? (
                          <p className="mt-2 text-xs text-slate-300">
                            Latest plan:{" "}
                            <span className="font-medium">{latestPlan.summary}</span>
                          </p>
                        ) : null}
                        {latestExecution ? (
                          <p className="mt-1 text-xs text-slate-300">
                            Latest probe:{" "}
                            <span className="font-medium">{latestExecution.toolId}</span>{" "}
                            {"->"}{" "}
                            <span className="font-medium uppercase">
                              {latestExecution.status}
                            </span>
                          </p>
                        ) : null}
                        {topMatchByEngagement[engagement._id] ? (
                          <p className="mt-1 text-xs text-slate-300">
                            Top match:{" "}
                            <span className="font-medium">
                              {topMatchByEngagement[engagement._id]?.name}
                            </span>{" "}
                            ({topMatchByEngagement[engagement._id]?.score.toFixed(2)})
                          </p>
                        ) : null}
                        {compliance ? (
                          <p className="mt-1 text-xs text-slate-300">
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
                          <p className="mt-1 text-xs text-slate-300">
                            Learning:{" "}
                            <span className="font-medium">
                              {learningSummaryByEngagement[engagement._id]}
                            </span>
                          </p>
                        ) : null}
                        {chainSummary ? (
                          <p className="mt-1 text-xs text-slate-300">
                            Week 10 chain:{" "}
                            <span className="font-medium">
                              {chainSummary.stepsExecuted}/{chainSummary.stepsPlanned} via{" "}
                              {chainSummary.source}
                            </span>
                          </p>
                        ) : null}
                        {evidenceStatus ? (
                          <p className="mt-1 text-xs text-slate-300">
                            Evidence integrity:{" "}
                            <span className="font-medium">
                              {evidenceStatus.valid
                                ? `VALID (${evidenceStatus.totalItems})`
                                : `BROKEN at ${evidenceStatus.brokenAt ?? "unknown"}`}
                            </span>
                          </p>
                        ) : null}
                      </>
                    )}

                    {progressByEngagement[engagement._id] ? (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                          <span>
                            Progress:{" "}
                            {progressByEngagement[engagement._id].currentPhase}
                          </span>
                          <span>
                            {progressByEngagement[engagement._id].progressPercent}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
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

        <article className="rounded-3xl border border-slate-800 bg-[#11161d]/95 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-sm xl:sticky xl:top-4">
          <h2 className="text-lg font-semibold text-slate-100">New Engagement</h2>
          <p className="mb-4 text-sm text-slate-400">
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
                className="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-3 py-2 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-lime-400 focus:ring-2 focus:ring-lime-500/20"
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
                className="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-3 py-2 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-lime-400 focus:ring-2 focus:ring-lime-500/20"
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
                className="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-3 py-2 text-slate-100 outline-none transition focus:border-lime-400 focus:ring-2 focus:ring-lime-500/20"
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
                className="w-full rounded-xl border border-slate-700 bg-slate-900/85 px-3 py-2 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-lime-400 focus:ring-2 focus:ring-lime-500/20"
                placeholder="Scope notes, objective, and context"
              />
            </label>

            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            {message ? <p className="text-sm text-lime-200">{message}</p> : null}

            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-xl bg-lime-500/90 px-4 py-2 font-semibold text-slate-950 transition hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {creating ? "Creating..." : "Create Engagement"}
            </button>
          </form>
        </article>
      </section>

      {engagementPendingDelete ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-100">
              Confirm Decommission
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              Remove engagement{" "}
              <span className="font-semibold text-slate-100">
                {engagementPendingDelete.name}
              </span>
              ? This will permanently delete associated plans and execution jobs.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
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
