"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import Navigation from "@/components/Navigation";
import { fetchEngagements, type Engagement } from "@/lib/api";
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

function statusTone(status: Engagement["status"]) {
  if (status === "completed") {
    return "border-cyan-400/45 bg-cyan-500/10 text-cyan-100";
  }
  if (status === "running") {
    return "border-lime-400/45 bg-lime-500/10 text-lime-100";
  }
  if (status === "failed") {
    return "border-rose-400/45 bg-rose-500/10 text-rose-100";
  }
  if (status === "paused") {
    return "border-amber-400/45 bg-amber-500/10 text-amber-100";
  }
  return "border-slate-600 bg-slate-800 text-slate-200";
}

export default function RecentScansPage() {
  const router = useRouter();
  const [session, setSession] = useState<VenomSession | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      try {
        const items = await fetchEngagements(current);
        if (mounted) {
          setEngagements(items);
        }
      } catch (requestError) {
        if (mounted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Failed to load scans."
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
  }, [router]);

  const list = useMemo(() => engagements.slice(0, 30), [engagements]);

  return (
    <main className="min-h-screen bg-[#06090f] text-slate-100">
      <Navigation />

      <section className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="inline-flex rounded-full border border-cyan-400/45 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-100">
              Screen 3 Support
            </span>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Recent Scans</h1>
            <p className="mt-1 text-sm text-slate-400">
              Open any engagement to view the detailed report and Ask AI sidebar.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/dashboard/new-scan")}
            className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-lime-300"
          >
            Start New Scan
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6 text-sm text-slate-300">
            Loading scans...
          </div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-2xl border border-rose-500/45 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {!loading && !error && list.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6 text-sm text-slate-300">
            No scans yet. Start one from the New Scan page.
          </div>
        ) : null}

        {!loading && !error && list.length > 0 ? (
          <div className="grid gap-3">
            {list.map((engagement) => (
              <article
                key={engagement._id}
                className="rounded-2xl border border-slate-700 bg-slate-900/85 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">
                      {engagement.name || "Untitled scan"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Target: {engagement.targetUrl}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Created: {formatDate(engagement.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusTone(
                        engagement.status
                      )}`}
                    >
                      {engagement.status}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/dashboard/report/${encodeURIComponent(engagement._id)}`)
                      }
                      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-lime-400/45"
                    >
                      View Report
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {session ? (
          <p className="mt-6 text-xs text-slate-500">Signed in as {session.email}</p>
        ) : null}
      </section>
    </main>
  );
}
