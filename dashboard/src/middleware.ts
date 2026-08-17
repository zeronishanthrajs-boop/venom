import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME } from "@/lib/authConstants";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasAccessCookie = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  const hasRefreshCookie = Boolean(request.cookies.get(REFRESH_COOKIE_NAME)?.value);
  const hasAnyAuthCookie = hasAccessCookie || hasRefreshCookie;

  const isProtectedRoute =
    pathname.startsWith("/dashboard") ||
    pathname === "/dashboard";

  if (isProtectedRoute && !hasAnyAuthCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("reason", "auth_required");
    return NextResponse.redirect(loginUrl, 307);
  }

  if (pathname.startsWith("/api/backend") && !hasAnyAuthCookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/api/backend/:path*"
  ]
};
