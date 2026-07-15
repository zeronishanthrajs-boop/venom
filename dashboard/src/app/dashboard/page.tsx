"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import Navigation from "@/components/Navigation";
import ErrorBanner from "@/components/ErrorBanner";
import { ApiError, fetchEngagements, type Engagement } from "@/lib/api";
import { fetchSession, type VenomSession } from "@/lib/session";

function statusLabel(status: Engagement["status"]) {
  if (status === "running") {
    return "Running";
  }
  if (status === "completed") {
    return "Completed";
  }
  if (status === "failed") {
    return "Needs review";
  }
  if (status === "paused") {
    return "Paused";
  }
  return "Draft";
}

function statusClass(status: Engagement["status"]) {
  if (status === "completed") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }
  if (status === "running") {
    return "bg-blue-50 text-blue-700 ring-blue-200";
  }
  if (status === "failed") {
    return "bg-rose-50 text-rose-700 ring-rose-200";
  }
  if (status === "paused") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<VenomSession | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | ApiError | string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const current = await fetchSession();
    if (!current) {
      router.replace("/login");
      return;
    }

    setSession(current);
    try {
      setEngagements(await fetchEngagements(current));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [loadData]);

  const metrics = useMemo(() => {
    const total = engagements.length;
    const running = engagements.filter((item) => item.status === "running").length;
    const completed = engagements.filter((item) => item.status === "completed").length;
    const failed = engagements.filter((item) => item.status === "failed").length;
    return { total, running, completed, failed };
  }, [engagements]);

  const latest = engagements.slice(0, 6);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 lg:flex">
      <Navigation />

      <section className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
                Command Center
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                Security operations, without the clutter
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Start scans, watch active runs, open reports, and control execution from one place.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard/new-scan")}
              className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Start New Scan
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Total scans", metrics.total],
              ["Running now", metrics.running],
              ["Reports ready", metrics.completed],
              ["Needs review", metrics.failed]
            ].map(([label, value]) => (
              <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
              </article>
            ))}
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_0.8fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Recent activity</h2>
                  <p className="text-sm text-slate-500">Open the latest report or continue a scan.</p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/recent")}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  View all
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {loading ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading scans...</p>
                ) : null}

                {!loading && error ? <ErrorBanner error={error} onRetry={loadData} /> : null}

                {!loading && !error && latest.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    No scans yet. Start with one authorized target.
                  </p>
                ) : null}

                {latest.map((engagement) => (
                  <article
                    key={engagement._id}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold text-slate-950">{engagement.name || "Untitled scan"}</p>
                      <p className="mt-1 text-sm text-slate-500">{engagement.targetUrl}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusClass(engagement.status)}`}>
                        {statusLabel(engagement.status)}
                      </span>
                      <button
                        type="button"
                        onClick={() => router.push(`/dashboard/report/${encodeURIComponent(engagement._id)}`)}
                        className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        Report
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <aside className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-950">Recommended workflow</h2>
                <div className="mt-4 space-y-3">
                  {[
                    "Add an authorized target",
                    "Confirm scope and non-destructive mode",
                    "Monitor scan progress",
                    "Share the executive report"
                  ].map((item, index) => (
                    <div key={item} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                        {index + 1}
                      </span>
                      <p className="pt-1 text-sm text-slate-600">{item}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
                <h2 className="text-lg font-semibold">Controls stay separate</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Kill switches, scope preview, and activity logs now live in a dedicated control area.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/control")}
                  className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                >
                  Open Controls
                </button>
              </section>

              {session ? (
                <p className="text-xs text-slate-500">Signed in as {session.email}</p>
              ) : null}
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
