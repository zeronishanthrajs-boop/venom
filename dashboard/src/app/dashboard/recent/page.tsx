"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import Navigation from "@/components/Navigation";
import ErrorBanner from "@/components/ErrorBanner";
import { ApiError, fetchEngagements, type Engagement } from "@/lib/api";
import { fetchSession, type VenomSession } from "@/lib/session";

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

export default function RecentScansPage() {
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
      const items = await fetchEngagements(current);
      setEngagements(items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : "Failed to load scans.");
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

  const list = useMemo(() => engagements.slice(0, 50), [engagements]);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 lg:flex">
      <Navigation />

      <section className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
                Scan history
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                Reports and active runs
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Find recent targets, reopen reports, and move into controls when an engagement needs operator review.
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

          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {loading ? (
              <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading scans...</p>
            ) : null}

            {!loading && error ? <ErrorBanner error={error} onRetry={loadData} /> : null}

            {!loading && !error && list.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                <h2 className="text-lg font-semibold text-slate-950">No scans yet</h2>
                <p className="mt-2 text-sm text-slate-500">Launch one authorized scan to create your first report.</p>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/new-scan")}
                  className="mt-5 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Start Scan
                </button>
              </div>
            ) : null}

            {!loading && !error && list.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="grid grid-cols-[1.2fr_0.8fr_0.5fr_0.7fr] gap-3 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span>Target</span>
                  <span>Created</span>
                  <span>Status</span>
                  <span className="text-right">Actions</span>
                </div>
                <div className="divide-y divide-slate-200">
                  {list.map((engagement) => (
                    <article
                      key={engagement._id}
                      className="grid gap-3 px-4 py-4 text-sm sm:grid-cols-[1.2fr_0.8fr_0.5fr_0.7fr] sm:items-center"
                    >
                      <div>
                        <p className="font-semibold text-slate-950">{engagement.name || "Untitled scan"}</p>
                        <p className="mt-1 break-all text-slate-500">{engagement.targetUrl}</p>
                      </div>
                      <p className="text-slate-600">{formatDate(engagement.createdAt)}</p>
                      <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ${statusClass(engagement.status)}`}>
                        {engagement.status}
                      </span>
                      <div className="flex justify-start gap-2 sm:justify-end">
                        <button
                          type="button"
                          onClick={() => router.push(`/dashboard/report/${encodeURIComponent(engagement._id)}`)}
                          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                        >
                          Report
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/dashboard/control?engagementId=${encodeURIComponent(engagement._id)}`)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Controls
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {session ? (
              <p className="mt-5 text-xs text-slate-500">Signed in as {session.email}</p>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}
