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
      const resetTimer = window.setTimeout(() => {
        setCountdown(30);
      }, 0);
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
      return () => {
        window.clearTimeout(resetTimer);
        clearInterval(timer);
      };
    }
  }, [error, onRetry]);

  if (!error) return null;

  const isApiError = error instanceof Error && error.name === "ApiError";
  const errorType = isApiError ? (error as ApiError).errorType : "UNKNOWN";
  const message = typeof error === "string" ? error : error.message;

  if (errorType === "COLD_START") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-semibold">{message}</div>
        <div className="text-xs">Retrying automatically in {countdown}s...</div>
        {onRetry && countdown === 0 && (
          <button onClick={onRetry} className="mt-2 self-start rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800">
            Retry Now
          </button>
        )}
      </div>
    );
  }

  if (errorType === "SLOW_RESPONSE") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600"></div>
        <div>{message}</div>
        {onRetry && (
          <button onClick={onRetry} className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-100">
            Retry
          </button>
        )}
      </div>
    );
  }

  if (errorType === "GENERATION_TIMEOUT") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-semibold">{message}</div>
        {onRetry && (
          <button onClick={onRetry} className="mt-2 self-start rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-800">
            Try again
          </button>
        )}
      </div>
    );
  }

  // UNKNOWN / Default
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      <div className="font-semibold">{message}</div>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 self-start rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-800">
          Refresh page
        </button>
      )}
    </div>
  );
}
