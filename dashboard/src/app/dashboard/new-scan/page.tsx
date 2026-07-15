"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import Navigation from "@/components/Navigation";
import ErrorBanner from "@/components/ErrorBanner";
import {
  ApiError,
  createEngagement,
  fetchScoreHistory,
  type ScoreHistoryRecord
} from "@/lib/api";
import { fetchSession, type VenomSession } from "@/lib/session";

function normalizeTarget(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function buildTrendPath(records: ScoreHistoryRecord[]) {
  if (records.length === 0) {
    return "";
  }
  if (records.length === 1) {
    const y = 100 - Math.max(0, Math.min(100, records[0].score));
    return `M 0 ${y} L 100 ${y}`;
  }
  return records
    .map((record, index) => {
      const x = (index / Math.max(1, records.length - 1)) * 100;
      const y = 100 - Math.max(0, Math.min(100, record.score));
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function NewScanPage() {
  const router = useRouter();
  const [targetUrl, setTargetUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | ApiError | string | null>(null);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryRecord[]>([]);

  const cleanTarget = useMemo(() => normalizeTarget(targetUrl), [targetUrl]);
  const latestScore = scoreHistory.at(-1)?.score ?? null;
  const trendPath = useMemo(() => buildTrendPath(scoreHistory), [scoreHistory]);

  useEffect(() => {
    let cancelled = false;

    async function loadScoreHistory() {
      const session = await fetchSession();
      if (!session) {
        return;
      }
      const response = await fetchScoreHistory(session, 30);
      if (!cancelled) {
        setScoreHistory(response.records);
      }
    }

    void loadScoreHistory().catch(() => {
      if (!cancelled) {
        setScoreHistory([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function requireSession(): Promise<VenomSession | null> {
    const current = await fetchSession();
    if (!current) {
      router.replace("/login");
      return null;
    }
    return current;
  }

  async function handleStartScan() {
    setError(null);
    if (!cleanTarget) {
      setError("Enter a target URL or domain.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(cleanTarget);
    } catch {
      setError("Enter a valid target, like zeroops.in or https://zeroops.in.");
      return;
    }

    setLoading(true);

    try {
      const session = await requireSession();
      if (!session) {
        return;
      }

      const engagement = await createEngagement(session, {
        name: `${parsed.hostname} baseline`,
        description: "Command center scan: non-destructive startup baseline assessment.",
        targetUrl: cleanTarget,
        targetType: "website",
        autoOrchestrate: true,
        scanProfile: "startup",
        startupConcern: "Routine startup security check",
        ownershipAssertion: "I have written authorization from the domain owner"
      });

      router.push(`/dashboard/report/${engagement._id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : "Failed to start scan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 lg:flex">
      <Navigation />

      <section className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
              New scan
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Launch an authorized baseline scan
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Enter a target once. VENOM normalizes the URL, starts orchestration, and opens the report as evidence lands.
            </p>

            <div className="mt-7 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-2xl border border-slate-200 p-5">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-800">Target URL or domain</span>
                  <input
                    type="text"
                    value={targetUrl}
                    onChange={(event) => setTargetUrl(event.target.value)}
                    placeholder="zeroops.in"
                    disabled={loading}
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                  />
                </label>

                <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                  {cleanTarget ? `Scan target: ${cleanTarget}` : "Bare domains are accepted and converted to HTTPS."}
                </div>

                <button
                  type="button"
                  onClick={() => void handleStartScan()}
                  disabled={loading}
                  className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loading ? "Starting scan..." : "Start scan and open report"}
                </button>

                {error ? (
                  <div className="mt-4">
                    <ErrorBanner error={error} onRetry={handleStartScan} />
                  </div>
                ) : null}
              </section>

              <aside className="space-y-5">
                <section className="rounded-2xl border border-slate-200 p-5">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Scan policy
                  </h2>
                  <div className="mt-4 space-y-3">
                    {[
                      ["Mode", "Non-destructive startup profile"],
                      ["Scope", "Domain-focused web assessment"],
                      ["Output", "Executive report plus technical evidence"]
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                        <span className="text-sm text-slate-500">{label}</span>
                        <span className="text-right text-sm font-semibold text-slate-900">{value}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-slate-200 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      30-day score trend
                    </h2>
                    <span className="text-sm font-semibold text-blue-700">
                      {latestScore === null ? "No score" : `${latestScore}/100`}
                    </span>
                  </div>
                  <div className="mt-4 h-32 w-full overflow-hidden rounded-xl bg-slate-50">
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="h-full w-full"
                      role="img"
                      aria-label="30-day security score trend"
                    >
                      <line x1="0" y1="25" x2="100" y2="25" stroke="#d8dee8" strokeWidth="0.5" />
                      <line x1="0" y1="50" x2="100" y2="50" stroke="#d8dee8" strokeWidth="0.5" />
                      <line x1="0" y1="75" x2="100" y2="75" stroke="#d8dee8" strokeWidth="0.5" />
                      {trendPath ? (
                        <path
                          d={trendPath}
                          fill="none"
                          stroke="#2563eb"
                          strokeWidth="2.5"
                          vectorEffect="non-scaling-stroke"
                        />
                      ) : null}
                    </svg>
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
