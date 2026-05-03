"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const queryReason =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("reason")
          : null;
      if (mounted) {
        setReason(queryReason);
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Email and password are required.");
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
        setError(payload.error || "Login failed. Check credentials.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Unable to contact login service. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(15,118,110,0.30),transparent_38%),radial-gradient(circle_at_82%_12%,rgba(14,36,49,0.16),transparent_34%),linear-gradient(160deg,#f7fbff_0%,#ecf4f8_46%,#e6f1f4_100%)]" />
      <div className="pointer-events-none absolute -left-24 top-28 h-72 w-72 rounded-full border border-white/40 bg-white/20 blur-2xl" />
      <div className="pointer-events-none absolute -right-16 bottom-16 h-64 w-64 rounded-full border border-white/40 bg-teal-100/30 blur-2xl" />

      <section className="relative grid w-full max-w-5xl gap-6 rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)] backdrop-blur-xl lg:grid-cols-[1.1fr_1fr] lg:p-10">
        <div className="rounded-3xl border border-slate-200/80 bg-white/85 p-6 lg:p-8">
          <p className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            Private Operator Access
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-slate-900">
            VENOM Command Portal
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            Access is restricted to authorized leadership credentials. Session is
            validated server-side and all backend calls run through a protected
            bridge.
          </p>

          <div className="mt-6 grid gap-3 text-sm text-slate-700">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3">
              Zero-trust dashboard gate with signed session cookies.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3">
              Backend API key is held server-side only.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3">
              Ready for Render + Vercel deployment flow.
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200/80 bg-white p-6 lg:p-8">
          <h2 className="text-xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-600">
            Enter your approved operator credentials.
          </p>

          {reason === "auth_required" ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Your session expired or was missing. Please sign in again.
            </p>
          ) : null}

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                placeholder="nishanthrajs01@gmail.com"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                placeholder="********"
              />
            </label>

            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? "Verifying access..." : "Enter Dashboard"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
