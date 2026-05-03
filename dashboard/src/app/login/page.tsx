"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSession, saveSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [role, setRole] = useState("operator");
  const [error, setError] = useState("");

  useEffect(() => {
    const existing = loadSession();
    if (existing) {
      router.replace("/dashboard");
    }
  }, [router]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!email || !password || !apiKey) {
      setError("Email, password, and API key are required.");
      return;
    }

    saveSession({
      email,
      role,
      apiKey
    });

    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="w-full max-w-md rounded-2xl border border-black/10 bg-white/90 p-8 shadow-xl backdrop-blur-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            VENOM Access
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            Security Dashboard Login
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Use your operator details and backend API key.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="you@company.com"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="••••••••"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">VENOM API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              placeholder="x-api-key value"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            >
              <option value="operator">Operator</option>
              <option value="lead">Lead</option>
              <option value="observer">Observer</option>
            </select>
          </label>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <button
            type="submit"
            className="w-full rounded-xl bg-accent px-4 py-2 font-semibold text-white transition hover:brightness-110"
          >
            Enter Dashboard
          </button>
        </form>
      </section>
    </main>
  );
}
