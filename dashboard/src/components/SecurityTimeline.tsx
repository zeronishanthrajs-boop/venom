"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createSecuritySnapshot,
  fetchSecurityChanges,
  fetchSecuritySnapshots,
  type SecurityChangeSet,
  type SecuritySnapshot
} from "@/lib/api";
import type { VenomSession } from "@/lib/session";

const severityTone: Record<string, string> = {
  critical: "border-rose-500/55 bg-rose-500/10 text-rose-200",
  high: "border-orange-500/55 bg-orange-500/10 text-orange-200",
  medium: "border-amber-500/55 bg-amber-500/10 text-amber-200",
  low: "border-cyan-500/55 bg-cyan-500/10 text-cyan-200",
  info: "border-slate-600 bg-slate-800 text-slate-300"
};

export function SecurityTimeline({
  session,
  engagementId
}: {
  session: VenomSession;
  engagementId: string;
}) {
  const [snapshots, setSnapshots] = useState<SecuritySnapshot[]>([]);
  const [changes, setChanges] = useState<SecurityChangeSet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [items, delta] = await Promise.all([
        fetchSecuritySnapshots(session, engagementId, 8),
        fetchSecurityChanges(session, engagementId)
      ]);
      setSnapshots(items);
      setChanges(delta);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load security timeline."
      );
    } finally {
      setLoading(false);
    }
  }, [engagementId, session]);

  async function captureSnapshot() {
    setLoading(true);
    setError("");
    try {
      await createSecuritySnapshot(session, engagementId, "manual");
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create snapshot."
      );
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  return (
    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Continuous Monitoring
          </p>
          <p className="text-sm font-semibold text-slate-100">
            Security Timeline
          </p>
        </div>
        <button
          type="button"
          onClick={() => void captureSnapshot()}
          disabled={loading}
          className="rounded-lg border border-lime-500/45 bg-lime-500/10 px-2 py-1 text-[11px] font-semibold text-lime-200 transition hover:bg-lime-500/20 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Working..." : "Capture Snapshot"}
        </button>
      </div>

      {changes ? (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            changes.changesFound
              ? "border-amber-500/45 bg-amber-500/10 text-amber-200"
              : "border-lime-500/45 bg-lime-500/10 text-lime-200"
          }`}
        >
          {changes.changeSummary}
          <div className="mt-1 text-[11px] opacity-90">
            Gap {changes.scanGapHours}h | +{changes.newFindings.length} new |{" "}
            {changes.resolvedFindings.length} resolved
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400">No change data available yet.</p>
      )}

      {snapshots.length > 0 ? (
        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {snapshots.map((snapshot, index) => (
            <article
              key={snapshot._id}
              className="rounded-lg border border-slate-700 bg-slate-950/65 p-2"
            >
              <p className="text-[11px] text-slate-400">
                {new Date(snapshot.snapshotAt).toLocaleString()} |{" "}
                {snapshot.snapshotType}
                {index === 0 ? " | latest" : ""}
              </p>
              <p className="mt-1 text-xs text-slate-200">
                Risk {snapshot.riskScore}/100 | Findings {snapshot.findings.length} |
                Ports {snapshot.openPorts.length}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {snapshot.findings.slice(0, 4).map((finding, findingIndex) => (
                  <span
                    key={`${snapshot._id}-${findingIndex}`}
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      severityTone[finding.severity] || severityTone.info
                    }`}
                  >
                    {finding.title || "untitled"}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">No snapshots recorded yet.</p>
      )}

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
