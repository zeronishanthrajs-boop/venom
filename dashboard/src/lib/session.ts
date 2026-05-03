export type VenomSession = {
  email: string;
  role: "owner";
  expiresAt: string;
};

export async function fetchSession(): Promise<VenomSession | null> {
  try {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { session?: VenomSession | null };
    return payload.session || null;
  } catch {
    return null;
  }
}

export async function logoutSession(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    cache: "no-store"
  }).catch(() => undefined);
}
