"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createEngagement,
  fetchAlerts,
  fetchAllProgress,
  fetchExecutionJobs,
  fetchMetricsOverview,
  fetchMatchedPatterns,
  fetchPlansForEngagement,
  fetchEngagements,
  generatePlan,
  runLearning,
  runExecutionJob,
  type AlertItem,
  type CreateEngagementInput,
  type Engagement,
  type EngagementProgress,
  type ExecutionJob,
  type MetricsOverview,
  type Plan
} from "@/lib/api";
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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
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
  const [metricsOverview, setMetricsOverview] = useState<MetricsOverview | null>(
    null
  );
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [progressByEngagement, setProgressByEngagement] = useState<
    Record<string, EngagementProgress>
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
      const [overview, alertPayload, progress] = await Promise.all([
        fetchMetricsOverview(activeSession),
        fetchAlerts(activeSession),
        fetchAllProgress(activeSession)
      ]);
      setMetricsOverview(overview);
      setAlerts(alertPayload.alerts);
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
              {alerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {alert.severity}
                  </p>
                  <p className="font-medium">{alert.title}</p>
                  <p className="text-sm text-slate-600">{alert.message}</p>
                </article>
              ))}
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
              {engagements.map((engagement) => (
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
                  </div>
                  {latestPlanByEngagement[engagement._id] ? (
                    <p className="mt-2 text-xs text-slate-600">
                      Latest plan:{" "}
                      <span className="font-medium">
                        {latestPlanByEngagement[engagement._id]?.summary}
                      </span>
                    </p>
                  ) : null}
                  {latestExecutionByEngagement[engagement._id] ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Latest probe:{" "}
                      <span className="font-medium">
                        {latestExecutionByEngagement[engagement._id]?.toolId}
                      </span>{" "}
                      {"->"}{" "}
                      <span className="font-medium uppercase">
                        {latestExecutionByEngagement[engagement._id]?.status}
                      </span>
                    </p>
                  ) : null}
                  {topMatchByEngagement[engagement._id] ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Top match:{" "}
                      <span className="font-medium">
                        {topMatchByEngagement[engagement._id]?.name}
                      </span>{" "}
                      (
                      {topMatchByEngagement[engagement._id]?.score.toFixed(2)})
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
              ))}
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
    </main>
  );
}
