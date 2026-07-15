"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchSession } from "@/lib/session";

type ReadyState = {
  status: "checking" | "ready" | "down";
  message: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [readyState, setReadyState] = useState<ReadyState>({
    status: "checking",
    message: "Checking backend readiness..."
  });

  useEffect(() => {
    let mounted = true;

    (async () => {
      const queryReason =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("reason")
          : null;

      if (mounted && queryReason === "auth_required") {
        setToast("Session expired. Sign in to continue.");
      }

      const existing = await fetchSession();
      if (mounted && existing) {
        router.replace("/dashboard");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  useEffect(() => {
    async function checkReady() {
      try {
        const response = await fetch("/api/system/ready", {
          method: "GET",
          cache: "no-store"
        });

        const payload = (await response.json().catch(() => ({}))) as {
          ready?: boolean;
          backend?: { db?: { source?: string } };
          error?: string;
        };

        if (response.ok && payload.ready) {
          const source = payload.backend?.db?.source || "backend";
          setReadyState({
            status: "ready",
            message: `Ready. Database online via ${source}.`
          });
          return;
        }

        setReadyState({
          status: "down",
          message:
            payload.error ||
            "Backend is not ready. Check Render, MongoDB, or /ready."
        });
      } catch {
        setReadyState({
          status: "down",
          message: "Readiness probe failed. Network path unavailable."
        });
      }
    }

    void checkReady();
    const timer = window.setInterval(() => {
      void checkReady();
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 4200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const statusTone = useMemo(() => {
    if (readyState.status === "ready") {
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    }
    if (readyState.status === "down") {
      return "border-rose-200 bg-rose-50 text-rose-700";
    }
    return "border-slate-200 bg-slate-50 text-slate-600";
  }, [readyState.status]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToast(null);

    if (!email || !password) {
      setToast("Email and password are required.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setToast(payload.error || "Access denied. Check your credentials.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setToast("Control plane unreachable. Retry in a few seconds.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[calc(100vh-64px)] max-w-6xl items-center gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-base font-bold text-white">
            V
          </span>
          <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-blue-700">
            VENOM command center
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
            Sign in to manage security scans.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600">
            Launch authorized scans, review reports, and control execution from a focused operator workspace.
          </p>

          <div className={`mt-6 rounded-2xl border p-4 text-sm ${statusTone}`}>
            <p className="font-semibold">System status</p>
            <p className="mt-1">{readyState.message}</p>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">Operator login</h2>
            <p className="mt-2 text-sm text-slate-500">
              Use your dashboard credentials to continue.
            </p>
          </div>

          {toast ? (
            <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {toast}
            </p>
          ) : null}

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-sm font-semibold text-slate-800">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="owner@example.com"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-800">Password</span>
              <div className="relative mt-2">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 pr-24 text-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {submitting ? "Signing in..." : "Enter dashboard"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
