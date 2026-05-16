"use client";

import { useEffect, useState } from "react";
import {
  fetchPlanExplanation,
  type PlanExplainResponse,
  type PlanLearnedPattern
} from "@/lib/api";
import type { VenomSession } from "@/lib/session";

type LearningInsightsProps = {
  engagementId: string;
  session: VenomSession | null;
};

function toPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value || 0))) * 100)}%`;
}

function renderPatternLine(item: PlanLearnedPattern) {
  return `${item.condition} (${toPercent(item.confidence)} confidence, ${toPercent(
    item.successRate
  )} success)`;
}

export default function LearningInsights({
  engagementId,
  session
}: LearningInsightsProps) {
  const [insights, setInsights] = useState<PlanExplainResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session || !engagementId) {
      return;
    }

    let cancelled = false;
    const runTimer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      setLoading(true);
      setError("");

      (async () => {
        try {
          const response = await fetchPlanExplanation(session, engagementId);
          if (!cancelled) {
            setInsights(response);
          }
        } catch (requestError) {
          if (!cancelled) {
            setInsights(null);
            setError(
              requestError instanceof Error
                ? requestError.message
                : "Failed to load learning insights."
            );
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(runTimer);
    };
  }, [engagementId, session]);

  if (!session) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">
        Learning Insights
      </p>

      {loading ? (
        <p className="mt-1 text-xs text-slate-400">Loading insights...</p>
      ) : null}

      {!loading && error ? (
        <p className="mt-1 text-xs text-amber-300">
          Insights unavailable: {error}
        </p>
      ) : null}

      {!loading && !error && !insights ? (
        <p className="mt-1 text-xs text-slate-400">No learning data yet.</p>
      ) : null}

      {!loading && !error && insights ? (
        <>
          <p className="mt-1 text-xs text-slate-300">{insights.explanation}</p>
          <p className="mt-2 text-xs text-slate-300">
            Plan confidence:{" "}
            <span className="font-medium text-slate-100">
              {toPercent(insights.confidence)}
            </span>
          </p>
          <p className="mt-2 text-xs text-slate-300">
            Learned patterns: {insights.learnedPatterns.length}
          </p>
          {insights.learnedPatterns.length > 0 ? (
            <ul className="mt-1 space-y-1 text-xs text-slate-300">
              {insights.learnedPatterns.slice(0, 4).map((item) => (
                <li key={`${item.condition}-${item.learnedFrom}`}>
                  {renderPatternLine(item)}
                </li>
              ))}
            </ul>
          ) : null}
          {insights.plan.length > 0 ? (
            <>
              <p className="mt-2 text-xs text-slate-300">Suggested tools:</p>
              <ul className="mt-1 space-y-1 text-xs text-slate-300">
                {insights.plan.slice(0, 3).map((item) => (
                  <li key={`${item.condition}-${item.tool}`}>
                    {item.tool} from {item.condition} ({toPercent(item.expectedSuccess)} expected)
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
