"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import Navigation from "@/components/Navigation";
import {
  createEngagement,
  fetchScoreHistory,
  ApiError,
  type ScoreHistoryRecord
} from "@/lib/api";
import { fetchSession, type VenomSession } from "@/lib/session";
import ErrorBanner from "@/components/ErrorBanner";

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
      setError("Please enter a target URL.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(cleanTarget);
    } catch {
      setError("Please enter a valid URL (example: https://example.com).");
      return;
    }

    setLoading(true);

    try {
      const session = await requireSession();
      if (!session) {
        return;
      }

      const engagement = await createEngagement(session, {
        name: `${parsed.hostname} auto scan`,
        description:
          "Simplified dashboard flow: auto-orchestrated baseline assessment.",
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
    <main className="min-h-screen bg-[#06090f] text-slate-100">
      <Navigation />

      <section className="mx-auto flex min-h-[calc(100vh-68px)] w-full max-w-4xl items-center px-4 py-10">
        <div className="w-full rounded-3xl border border-slate-700/80 bg-[#101722]/92 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:p-8">
          <span className="inline-flex rounded-full border border-lime-400/50 bg-lime-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-lime-200">
            Screen 2 of 3
          </span>
          <h1 className="mt-4 text-3xl font-semibold text-slate-100 sm:text-4xl">
            Start Security Scan
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
            Enter your target URL once. VENOM will automatically plan, run tools,
            learn patterns, and compile a full report.
          </p>

          <div className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-200">
                Target URL
              </span>
              <input
                type="text"
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="https://example.com"
                disabled={loading}
                className="w-full rounded-xl border border-slate-600 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-lime-400 focus:ring-2 focus:ring-lime-500/25 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </label>

            <button
              type="button"
              onClick={() => void handleStartScan()}
              disabled={loading}
              className="w-full rounded-xl bg-lime-400 px-4 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-slate-950 transition hover:bg-lime-300 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Starting Scan..." : "Start Scan"}
            </button>

            {error ? (
              <ErrorBanner error={error} onRetry={handleStartScan} />
            ) : null}
          </div>

          <div className="mt-8 rounded-2xl border border-lime-500/30 bg-lime-500/10 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-lime-200">
              What Happens Next
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-200">
              <li>1. Attack plan is generated automatically.</li>
              <li>2. Recon and validation tools run in sequence.</li>
              <li>3. Findings are learned and prioritized.</li>
              <li>4. A report is assembled while scans continue.</li>
              <li>5. You can ask AI follow-up questions in report view.</li>
            </ul>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-700/80 bg-slate-950/55 p-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-200">
                30-Day Score Trend
              </h2>
              <span className="text-sm font-semibold text-lime-200">
                {latestScore === null ? "No score yet" : `${latestScore}/100`}
              </span>
            </div>
            <div className="mt-4 h-32 w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="h-full w-full"
                role="img"
                aria-label="30-day security score trend"
              >
                <line x1="0" y1="25" x2="100" y2="25" stroke="#1f2937" strokeWidth="0.5" />
                <line x1="0" y1="50" x2="100" y2="50" stroke="#1f2937" strokeWidth="0.5" />
                <line x1="0" y1="75" x2="100" y2="75" stroke="#1f2937" strokeWidth="0.5" />
                {trendPath ? (
                  <path
                    d={trendPath}
                    fill="none"
                    stroke="#a3e635"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </svg>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
