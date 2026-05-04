"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchActionPreview,
  fetchActivityLogs,
  fetchKillSwitchState,
  fetchScopeDashboard,
  setEngagementKillSwitchState,
  setGlobalKillSwitchState,
  type ActionPreview,
  type ActivityLogResponse,
  type KillSwitchState,
  type ScopeDashboard
} from "@/lib/api";
import type { VenomSession } from "@/lib/session";

export function TrustControlPanel({
  session,
  engagementId
}: {
  session: VenomSession;
  engagementId: string;
}) {
  const [scope, setScope] = useState<ScopeDashboard | null>(null);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [killSwitch, setKillSwitch] = useState<KillSwitchState | null>(null);
  const [activity, setActivity] = useState<ActivityLogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [scopeData, previewData, killData, activityData] = await Promise.all([
        fetchScopeDashboard(session, engagementId),
        fetchActionPreview(session, engagementId),
        fetchKillSwitchState(session, engagementId),
        fetchActivityLogs(session, 8)
      ]);
      setScope(scopeData);
      setPreview(previewData);
      setKillSwitch(killData);
      setActivity(activityData);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load trust/control data."
      );
    } finally {
      setLoading(false);
    }
  }, [engagementId, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  async function setGlobal(active: boolean) {
    try {
      const nextState = await setGlobalKillSwitchState(
        session,
        active,
        active
          ? "Manual operator halt: global execution freeze."
          : "Global kill switch released."
      );
      setKillSwitch(nextState);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update global kill switch."
      );
    }
  }

  async function setEngagement(active: boolean) {
    try {
      const nextState = await setEngagementKillSwitchState(
        session,
        engagementId,
        active,
        active
          ? "Manual operator halt: engagement execution freeze."
          : "Engagement kill switch released."
      );
      setKillSwitch(nextState);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update engagement kill switch."
      );
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Trust + Control
          </p>
          <p className="text-sm font-semibold text-slate-100">
            Scope, Action Preview, Kill Switch
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {killSwitch ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <article
            className={`rounded-lg border px-3 py-2 text-xs ${
              killSwitch.global.active
                ? "border-rose-500/55 bg-rose-500/10 text-rose-200"
                : "border-lime-500/45 bg-lime-500/10 text-lime-200"
            }`}
          >
            <p className="font-semibold">Global Kill Switch</p>
            <p className="mt-1">
              {killSwitch.global.active
                ? `ACTIVE: ${killSwitch.global.reason || "Execution blocked"}`
                : "Inactive"}
            </p>
            <button
              type="button"
              onClick={() => void setGlobal(!killSwitch.global.active)}
              className="mt-2 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-[11px]"
            >
              {killSwitch.global.active ? "Release Global" : "Activate Global"}
            </button>
          </article>

          <article
            className={`rounded-lg border px-3 py-2 text-xs ${
              killSwitch.engagement.active
                ? "border-rose-500/55 bg-rose-500/10 text-rose-200"
                : "border-cyan-500/45 bg-cyan-500/10 text-cyan-200"
            }`}
          >
            <p className="font-semibold">Engagement Kill Switch</p>
            <p className="mt-1">
              {killSwitch.engagement.active
                ? `ACTIVE: ${killSwitch.engagement.reason || "Execution blocked"}`
                : "Inactive"}
            </p>
            <button
              type="button"
              onClick={() => void setEngagement(!killSwitch.engagement.active)}
              className="mt-2 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-[11px]"
            >
              {killSwitch.engagement.active
                ? "Release Engagement"
                : "Activate Engagement"}
            </button>
          </article>
        </div>
      ) : null}

      {scope ? (
        <article className="rounded-lg border border-slate-700 bg-slate-950/65 p-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Scope Dashboard
          </p>
          <p className="mt-1 text-xs text-slate-200">
            Allowed domains: {scope.allowedDomains.join(", ") || "none"}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Restricted paths: {scope.restrictedPaths.join(", ") || "none"}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Planned tools: {scope.plannedTools.join(", ") || "none"}
          </p>
        </article>
      ) : null}

      {preview ? (
        <article className="rounded-lg border border-slate-700 bg-slate-950/65 p-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Action Preview
          </p>
          <div className="mt-1 max-h-28 space-y-1 overflow-y-auto text-xs text-slate-300">
            {preview.actions.map((action) => (
              <p key={`${action.order}-${action.toolId}`}>
                {action.order}. {action.toolId} ({action.riskLevel}) -{" "}
                {action.description}
              </p>
            ))}
          </div>
        </article>
      ) : null}

      {activity ? (
        <article className="rounded-lg border border-slate-700 bg-slate-950/65 p-2">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Recent Activity
          </p>
          <div className="mt-1 max-h-24 space-y-1 overflow-y-auto text-xs text-slate-300">
            {activity.logs.slice(0, 6).map((entry, index) => (
              <p key={`${entry.createdAt}-${index}`}>
                {new Date(entry.createdAt).toLocaleTimeString()} | {entry.method}{" "}
                {entry.path} {"->"} {entry.statusCode}
              </p>
            ))}
          </div>
        </article>
      ) : null}

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
