"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

export default function ErrorBanner({ 
  error, 
  onRetry 
}: { 
  error: Error | ApiError | string | null,
  onRetry?: () => void
}) {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (!error) return;
    
    const isApiError = error instanceof Error && error.name === "ApiError";
    const errorType = isApiError ? (error as ApiError).errorType : "UNKNOWN";

    if (errorType === "COLD_START") {
      setCountdown(30);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            if (onRetry) onRetry();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [error, onRetry]);

  if (!error) return null;

  const isApiError = error instanceof Error && error.name === "ApiError";
  const errorType = isApiError ? (error as ApiError).errorType : "UNKNOWN";
  const message = typeof error === "string" ? error : error.message;

  if (errorType === "COLD_START") {
    return (
      <div className="rounded-2xl border border-amber-500/45 bg-amber-500/10 p-4 text-sm text-amber-200 flex flex-col gap-2">
        <div className="font-semibold">{message}</div>
        <div className="text-xs">Retrying automatically in {countdown}s...</div>
        {onRetry && countdown === 0 && (
          <button onClick={onRetry} className="mt-2 self-start rounded bg-amber-500/20 px-3 py-1 text-xs hover:bg-amber-500/30 transition">
            Retry Now
          </button>
        )}
      </div>
    );
  }

  if (errorType === "SLOW_RESPONSE") {
    return (
      <div className="rounded-2xl border border-slate-500/45 bg-slate-500/10 p-4 text-sm text-slate-300 flex items-center gap-3">
        <div className="animate-spin h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full"></div>
        <div>{message}</div>
        {onRetry && (
          <button onClick={onRetry} className="ml-auto rounded bg-slate-600/30 px-3 py-1 text-xs hover:bg-slate-600/50 transition">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (errorType === "GENERATION_TIMEOUT") {
    return (
      <div className="rounded-2xl border border-amber-500/45 bg-amber-500/10 p-4 text-sm text-amber-200 flex flex-col gap-2">
        <div className="font-semibold">{message}</div>
        {onRetry && (
          <button onClick={onRetry} className="mt-2 self-start rounded bg-amber-500/20 px-3 py-1 text-xs hover:bg-amber-500/30 transition">
            Try again
          </button>
        )}
      </div>
    );
  }

  // UNKNOWN / Default
  return (
    <div className="rounded-2xl border border-rose-500/45 bg-rose-500/10 p-4 text-sm text-rose-200 flex flex-col gap-2">
      <div className="font-semibold">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 self-start rounded bg-rose-500/20 px-3 py-1 text-xs hover:bg-rose-500/30 transition">
          Refresh page
        </button>
      )}
    </div>
  );
}
