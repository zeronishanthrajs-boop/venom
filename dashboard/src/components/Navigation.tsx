"use client";

import { usePathname, useRouter } from "next/navigation";

import { logoutSession } from "@/lib/session";

const navItems = [
  {
    label: "New Scan",
    href: "/dashboard/new-scan"
  },
  {
    label: "Recent Scans",
    href: "/dashboard/recent"
  }
];

export default function Navigation() {
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    await logoutSession();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#080d13]/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-lime-400/45 bg-lime-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-lime-200">
            VENOM
          </span>
          <span className="text-xs text-slate-400">Simplified Control</span>
        </div>

        <nav className="flex items-center gap-2">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => router.push(item.href)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "border-lime-400/55 bg-lime-400/15 text-lime-200"
                    : "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-slate-500"
                }`}
              >
                {item.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-rose-500/50 hover:text-rose-200"
          >
            Logout
          </button>
        </nav>
      </div>
    </header>
  );
}
