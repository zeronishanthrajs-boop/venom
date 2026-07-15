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

function stateTone(active: boolean) {
  return active
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : "border-emerald-200 bg-emerald-50 text-emerald-800";
}

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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
            Trust controls
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Review scope, preview actions, and halt execution when needed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {killSwitch ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[
            {
              title: "Global kill switch",
              active: killSwitch.global.active,
              reason: killSwitch.global.reason,
              action: () => void setGlobal(!killSwitch.global.active),
              label: killSwitch.global.active ? "Release global halt" : "Activate global halt"
            },
            {
              title: "Engagement kill switch",
              active: killSwitch.engagement.active,
              reason: killSwitch.engagement.reason,
              action: () => void setEngagement(!killSwitch.engagement.active),
              label: killSwitch.engagement.active
                ? "Release engagement halt"
                : "Activate engagement halt"
            }
          ].map((item) => (
            <article
              key={item.title}
              className={`rounded-2xl border p-4 ${stateTone(item.active)}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm">
                    {item.active ? item.reason || "Execution blocked" : "Inactive"}
                  </p>
                </div>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold">
                  {item.active ? "Active" : "Clear"}
                </span>
              </div>
              <button
                type="button"
                onClick={item.action}
                className={`mt-4 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  item.active
                    ? "bg-white text-rose-700 hover:bg-rose-100"
                    : "bg-emerald-700 text-white hover:bg-emerald-800"
                }`}
              >
                {item.label}
              </button>
            </article>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Scope dashboard
          </h3>
          {scope ? (
            <div className="mt-4 space-y-3 text-sm">
              <p>
                <span className="font-semibold text-slate-950">Allowed domains:</span>{" "}
                <span className="text-slate-600">
                  {scope.allowedDomains.join(", ") || "none"}
                </span>
              </p>
              <p>
                <span className="font-semibold text-slate-950">Restricted paths:</span>{" "}
                <span className="text-slate-600">
                  {scope.restrictedPaths.join(", ") || "none"}
                </span>
              </p>
              <p>
                <span className="font-semibold text-slate-950">Planned tools:</span>{" "}
                <span className="text-slate-600">
                  {scope.plannedTools.join(", ") || "none"}
                </span>
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Scope data has not loaded yet.</p>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Action preview
          </h3>
          {preview ? (
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {preview.actions.map((action) => (
                <div key={`${action.order}-${action.toolId}`} className="rounded-xl bg-slate-50 p-3 text-sm">
                  <p className="font-semibold text-slate-950">
                    {action.order}. {action.toolId}
                  </p>
                  <p className="mt-1 text-slate-600">{action.description}</p>
                  <span className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-xs font-semibold capitalize text-slate-600">
                    {action.riskLevel}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Action preview has not loaded yet.</p>
          )}
        </article>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent activity
        </h3>
        {activity ? (
          <div className="mt-4 divide-y divide-slate-100">
            {activity.logs.slice(0, 6).map((entry, index) => (
              <p key={`${entry.createdAt}-${index}`} className="py-2 text-sm text-slate-600">
                <span className="font-semibold text-slate-950">
                  {new Date(entry.createdAt).toLocaleTimeString()}
                </span>{" "}
                {entry.method} {entry.path} {"->"} {entry.statusCode}
              </p>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Activity has not loaded yet.</p>
        )}
      </article>
    </div>
  );
}
