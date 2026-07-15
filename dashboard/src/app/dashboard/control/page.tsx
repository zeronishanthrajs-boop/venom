"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import ErrorBanner from "@/components/ErrorBanner";
import Navigation from "@/components/Navigation";
import { TrustControlPanel } from "@/components/TrustControlPanel";
import { ApiError, fetchEngagements, type Engagement } from "@/lib/api";
import { fetchSession, type VenomSession } from "@/lib/session";

export default function ControlPage() {
  const router = useRouter();
  const [session, setSession] = useState<VenomSession | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selectedId, setSelectedId] = useState("");
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
      const requestedId =
        typeof window === "undefined"
          ? ""
          : new URLSearchParams(window.location.search).get("engagementId") || "";
      const fallbackId = items[0]?._id || "";
      setSelectedId((prev) => {
        if (prev && items.some((item) => item._id === prev)) {
          return prev;
        }
        if (requestedId && items.some((item) => item._id === requestedId)) {
          return requestedId;
        }
        return fallbackId;
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError : "Failed to load controls.");
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

  const selectedEngagement = useMemo(
    () => engagements.find((item) => item._id === selectedId) || null,
    [engagements, selectedId]
  );

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 lg:flex">
      <Navigation />

      <section className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
              Controls
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
              Scope, action preview, and kill switches
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Keep high-risk controls separated from reporting. Pick an engagement to review scope and freeze execution when needed.
            </p>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">Engagements</h2>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/new-scan")}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  New scan
                </button>
              </div>

              <div className="mt-4 space-y-2">
                {loading ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading controls...</p>
                ) : null}

                {!loading && error ? <ErrorBanner error={error} onRetry={loadData} /> : null}

                {!loading && !error && engagements.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                    Start a scan before using engagement controls.
                  </p>
                ) : null}

                {engagements.map((engagement) => (
                  <button
                    key={engagement._id}
                    type="button"
                    onClick={() => setSelectedId(engagement._id)}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      selectedId === engagement._id
                        ? "border-blue-300 bg-blue-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span className="block font-semibold text-slate-950">
                      {engagement.name || "Untitled scan"}
                    </span>
                    <span className="mt-1 block break-all text-sm text-slate-500">
                      {engagement.targetUrl}
                    </span>
                    <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold capitalize text-slate-600">
                      {engagement.status}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {session && selectedEngagement ? (
                <>
                  <div className="mb-4 border-b border-slate-200 pb-4">
                    <h2 className="text-lg font-semibold text-slate-950">
                      {selectedEngagement.name || "Selected engagement"}
                    </h2>
                    <p className="mt-1 break-all text-sm text-slate-500">
                      {selectedEngagement.targetUrl}
                    </p>
                  </div>
                  <TrustControlPanel
                    session={session}
                    engagementId={selectedEngagement._id}
                  />
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                  <h2 className="text-lg font-semibold text-slate-950">No engagement selected</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Select a scan to inspect scope, actions, and kill switch state.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
