"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchSession } from "@/lib/session";

const BOOT_LINES = [
  "[kernel] VENOM secure boot sequence initialized",
  "[auth] loading signed-session validation module",
  "[bridge] checking backend proxy channel integrity",
  "[db] probing engagement memory graph via /ready",
  "[telemetry] 5s auto-refresh daemon armed",
  "[status] v0.7 stable stack synchronized"
];

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
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [bootComplete, setBootComplete] = useState(false);
  const [readyState, setReadyState] = useState<ReadyState>({
    status: "checking",
    message: "Probing backend readiness..."
  });

  useEffect(() => {
    let mounted = true;

    (async () => {
      const queryReason =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("reason")
          : null;

      if (mounted && queryReason === "auth_required") {
        setToast("Session expired. Re-authenticate to continue operations.");
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
    let index = 0;
    let finalizeTimer: number | null = null;

    const timer = window.setInterval(() => {
      if (index >= BOOT_LINES.length) {
        window.clearInterval(timer);
        finalizeTimer = window.setTimeout(() => {
          setBootComplete(true);
        }, 350);
        return;
      }

      setBootLines((prev) => [...prev, BOOT_LINES[index]]);
      index += 1;
    }, 220);

    return () => {
      window.clearInterval(timer);
      if (finalizeTimer) {
        window.clearTimeout(finalizeTimer);
      }
    };
  }, []);

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
            message: `System Ready · DB online (${source})`
          });
          return;
        }

        setReadyState({
          status: "down",
          message:
            payload.error ||
            "Backend not ready. Check Render service, MongoDB, or backend /ready."
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

  const heartbeatClass = useMemo(() => {
    if (readyState.status === "ready") {
      return "bg-[#D1FF00] animate-pulse";
    }
    if (readyState.status === "down") {
      return "bg-[#FF3E3E]";
    }
    return "bg-slate-500 animate-pulse";
  }, [readyState.status]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setToast(null);

    if (!email || !password) {
      setToast("Email and password are mandatory for private operator access.");
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
        setToast(payload.error || "Access denied. Credential validation failed.");
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050505] px-4 py-10 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_14%,rgba(209,255,0,0.08),transparent_28%),radial-gradient(circle_at_78%_9%,rgba(255,62,62,0.08),transparent_26%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.02] [background-image:linear-gradient(rgba(255,255,255,0.9)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.9)_1px,transparent_1px)] [background-size:40px_40px]" />
      <div className="venom-noise pointer-events-none absolute inset-0" />

      <AnimatePresence>
        {toast ? (
          <motion.aside
            key={toast}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="venom-toast fixed right-6 top-6 z-50 w-[min(92vw,420px)] rounded-md border border-[#FF3E3E]/70 bg-black/85 px-4 py-3 text-sm text-[#ffdede] shadow-[0_0_30px_rgba(255,62,62,0.28)]"
          >
            <p className="font-mono">{toast}</p>
          </motion.aside>
        ) : null}
      </AnimatePresence>

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative w-full max-w-xl rounded-2xl border border-white/10 bg-[#111111]/88 p-5 shadow-[0_18px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:p-7"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#D1FF00]/30 bg-[#D1FF00]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#D1FF00]">
            Private Operator Access · Server-Side Auth
          </span>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] text-slate-300">
            <span className={`h-2.5 w-2.5 rounded-full ${heartbeatClass}`} />
            <span className="font-mono">{readyState.message}</span>
          </div>
        </div>

        <h1 className="venom-typewriter font-mono text-[clamp(1.4rem,3.5vw,2rem)] tracking-[0.08em] text-[#D1FF00] [text-shadow:0_0_12px_rgba(209,255,0,0.45)]">
          VENOM COMMAND PORTAL
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Tactical authentication terminal for authorized cyber operations.
        </p>

        {!bootComplete ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 rounded-xl border border-white/10 bg-black/55 p-4 font-mono text-xs leading-6 text-slate-300"
          >
            {bootLines.map((line) => (
              <p key={line} className="venom-bootline">
                {line}
              </p>
            ))}
            <p className="mt-2 text-[#D1FF00]">booting secure modules...</p>
          </motion.div>
        ) : (
          <motion.form
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mt-6 space-y-5"
            onSubmit={handleSubmit}
          >
            <label className="block">
              <span className="mb-2 block font-mono text-xs uppercase tracking-[0.14em] text-slate-400">
                Operator ID
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="authorized.email@domain"
                className="venom-input w-full bg-transparent px-1 pb-3 text-sm text-slate-100 outline-none placeholder:text-slate-600"
              />
            </label>

            <label className="block">
              <span className="mb-2 block font-mono text-xs uppercase tracking-[0.14em] text-slate-400">
                Passphrase
              </span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="************"
                  className="venom-input w-full bg-transparent px-1 pb-3 pr-12 text-sm text-slate-100 outline-none placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-0 top-0 inline-flex h-8 w-10 items-center justify-center text-slate-400 transition hover:text-[#D1FF00]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-4 w-4"
                    >
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                      <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c5.1 0 9.4 3.6 10.7 7-0.5 1.3-1.6 2.9-3.2 4.2" />
                      <path d="M6.2 6.2C4 7.6 2.6 9.6 1.3 12c1.4 3.6 5.7 7 10.7 7 1.6 0 3-.2 4.4-.8" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-4 w-4"
                    >
                      <path d="M1.3 12C2.6 8.6 6.9 5 12 5s9.4 3.6 10.7 7c-1.3 3.4-5.6 7-10.7 7S2.6 15.4 1.3 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="venom-glitch-btn relative w-full overflow-hidden rounded-md border border-[#D1FF00]/50 bg-[#D1FF00] px-4 py-2.5 text-sm font-semibold uppercase tracking-[0.14em] text-black transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Authorizing..." : "Enter Dashboard"}
            </button>
          </motion.form>
        )}
      </motion.section>

      <div className="fixed bottom-4 right-4 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-600">
        Version: v0.7 [STABLE]
      </div>
    </main>
  );
}

