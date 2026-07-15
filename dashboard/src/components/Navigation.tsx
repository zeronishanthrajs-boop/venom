"use client";

import { usePathname, useRouter } from "next/navigation";

import { logoutSession } from "@/lib/session";

const navItems = [
  {
    label: "Command Center",
    href: "/dashboard",
    description: "Live scan operations"
  },
  {
    label: "New Scan",
    href: "/dashboard/new-scan",
    description: "Launch a target assessment"
  },
  {
    label: "Scan History",
    href: "/dashboard/recent",
    description: "Reports and past runs"
  },
  {
    label: "Controls",
    href: "/dashboard/control",
    description: "Scope and kill switches"
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
    <aside className="sticky top-0 z-30 min-h-screen w-full border-r border-slate-200 bg-white/92 px-4 py-5 shadow-sm backdrop-blur lg:w-72">
      <div className="flex items-center justify-between gap-3 lg:block">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="text-left"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">
            V
          </span>
          <span className="ml-3 align-middle text-lg font-semibold text-slate-950">
            VENOM
          </span>
        </button>

        <button
          type="button"
          onClick={() => void handleLogout()}
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 lg:hidden"
        >
          Logout
        </button>
      </div>

      <p className="mt-3 hidden text-sm leading-6 text-slate-500 lg:block">
        Security scanning command center for startup teams.
      </p>

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
        {navItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => router.push(item.href)}
              className={`min-w-fit rounded-xl px-3 py-2 text-left transition lg:w-full ${
                active
                  ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className="hidden text-xs text-slate-500 lg:block">
                {item.description}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-6 hidden rounded-xl border border-slate-200 bg-slate-50 p-3 lg:block">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Operating Mode
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-950">
          Authorized, non-destructive scans
        </p>
      </div>

      <button
        type="button"
        onClick={() => void handleLogout()}
        className="mt-6 hidden w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 lg:block"
      >
        Logout
      </button>
    </aside>
  );
}
