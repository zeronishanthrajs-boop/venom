"use client";

import { useMemo, useState } from "react";

import type { ExecutionJob } from "@/lib/api";

type Audience = "founder" | "engineer" | "brief";

const audienceLabel: Record<Audience, string> = {
  founder: "Founder",
  engineer: "Engineer",
  brief: "Brief"
};

function toFallbackTranslation(
  finding: NonNullable<ExecutionJob["findings"]>[number],
  audience: Audience
) {
  const title = finding.title || "Security issue detected";
  const recommendation = finding.recommendation || "Review and remediate immediately.";
  if (audience === "brief") {
    return `[${finding.severity.toUpperCase()}] ${title}`;
  }
  if (audience === "engineer") {
    return `${title}. ${finding.description || "No description provided."} Remediation: ${recommendation}`;
  }
  return `${title}. ${finding.exploitationPotential || finding.description || "Potential business risk detected."} Action: ${recommendation}`;
}

export function FindingAudiencePanel({
  findings
}: {
  findings: ExecutionJob["findings"];
}) {
  const [audience, setAudience] = useState<Audience>("founder");

  const items = useMemo(() => (Array.isArray(findings) ? findings : []), [findings]);
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-2 text-xs text-slate-400">
        No translated findings available.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {(["founder", "engineer", "brief"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setAudience(key)}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
              audience === key
                ? "border-lime-400/55 bg-lime-500/10 text-lime-200"
                : "border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {audienceLabel[key]}
          </button>
        ))}
      </div>

      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {items.slice(0, 6).map((finding, index) => {
          const translatedText =
            finding.translations?.[audience] ||
            toFallbackTranslation(finding, audience);
          return (
            <article
              key={`${finding.id || finding.title}-${index}`}
              className="rounded border border-slate-800 bg-slate-900/80 p-2"
            >
              <p className="text-xs font-semibold text-slate-100">
                {finding.title || "Untitled finding"}
              </p>
              <p className="mt-1 text-xs text-slate-300">{translatedText}</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

