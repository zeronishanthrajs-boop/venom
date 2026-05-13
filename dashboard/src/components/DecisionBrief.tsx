"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchDecisionBrief,
  generateDecisionBriefNow,
  type DecisionBrief
} from "@/lib/api";
import type { VenomSession } from "@/lib/session";

const riskTone: Record<string, string> = {
  critical: "border-rose-500/55 bg-rose-500/10 text-rose-200",
  high: "border-orange-500/55 bg-orange-500/10 text-orange-200",
  medium: "border-amber-500/55 bg-amber-500/10 text-amber-200",
  low: "border-cyan-500/55 bg-cyan-500/10 text-cyan-200",
  clean: "border-lime-500/55 bg-lime-500/10 text-lime-200",
  unknown: "border-slate-600 bg-slate-800 text-slate-300"
};

export function DecisionBriefPanel({
  session,
  engagementId
}: {
  session: VenomSession;
  engagementId: string;
}) {
  const [brief, setBrief] = useState<DecisionBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (generate = false) => {
    setLoading(true);
    setError("");
    try {
      const result = generate
        ? await generateDecisionBriefNow(session, engagementId)
        : await fetchDecisionBrief(session, engagementId, false);
      setBrief(result);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to load decision brief.";
      if (!generate && /No brief yet/i.test(message)) {
        setBrief(null);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [engagementId, session]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(false);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [load]);

  const headerTone = useMemo(
    () => riskTone[brief?.riskLevel || "unknown"] || riskTone.unknown,
    [brief?.riskLevel]
  );

  if (!brief) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
        <p className="text-sm text-slate-300">
          No decision brief cached for this engagement.
        </p>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="mt-2 rounded-lg border border-violet-500/55 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Generating..." : "Generate Decision Brief"}
        </button>
        {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/80 p-3">
      <div className={`rounded-lg border px-3 py-2 ${headerTone}`}>
        <p className="text-[11px] uppercase tracking-wide">Decision Intelligence</p>
        <p className="mt-1 text-sm font-semibold">
          {brief.overallRiskSentence || "Risk summary unavailable."}
        </p>
        <p className="mt-1 text-xs">
          Risk score {brief.riskScore}/100 | Actionable {brief.actionableFindings} |
          Ignore {brief.ignoredFindings}
        </p>
      </div>

      {brief.topRisks.length > 0 ? (
        <div className="space-y-2">
          {brief.topRisks.slice(0, 3).map((risk) => (
            <article
              key={`${risk.rank}-${risk.title}`}
              className="rounded-lg border border-slate-700 bg-slate-950/70 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-100">
                  #{risk.rank} {risk.title}
                </p>
                <span className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-300">
                  {risk.fixDifficulty} | {risk.estimatedFixTime}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{risk.whyThisFirst}</p>
              <p className="mt-1 text-xs text-slate-400">
                Worst case: {risk.whatCouldHappen}
              </p>
              <p className="mt-1 text-xs text-lime-200">
                Immediate action: {risk.immediateAction}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">No prioritized risks yet.</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          Source: {brief.source} | Updated{" "}
          {new Date(brief.generatedAt).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Refreshing..." : "Refresh Brief"}
        </button>
      </div>

      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
