import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { verifyAuthToken } from "@/lib/auth";
import { isAuthTokenRevoked } from "@/lib/authRevocation";
import { AUTH_COOKIE_NAME } from "@/lib/authConstants";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value || null;
  if (isAuthTokenRevoked(token)) {
    return NextResponse.json({ session: null }, { status: 200 });
  }
  const session = verifyAuthToken(token);

  if (!session) {
    return NextResponse.json({ session: null }, { status: 200 });
  }

  return NextResponse.json({ session }, { status: 200 });
}
