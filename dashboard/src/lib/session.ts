export type VenomSession = {
  sid?: string;
  email: string;
  role: "owner";
  issuedAt?: string;
  expiresAt: string;
};

async function tryRefreshSession() {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    cache: "no-store"
  }).catch(() => null);
  return Boolean(response?.ok);
}

export async function fetchSession(): Promise<VenomSession | null> {
  try {
    const loadSession = async () =>
      fetch("/api/auth/session", {
        method: "GET",
        cache: "no-store"
      });

    let response = await loadSession();
    if (!response.ok) {
      return null;
    }

    let payload = (await response.json()) as { session?: VenomSession | null };
    if (!payload.session) {
      const refreshed = await tryRefreshSession();
      if (!refreshed) {
        return null;
      }
      response = await loadSession();
      if (!response.ok) {
        return null;
      }
      payload = (await response.json()) as { session?: VenomSession | null };
    }

    return payload.session || null;
  } catch {
    return null;
  }
}

export async function refreshSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      cache: "no-store"
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function logoutSession(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
    cache: "no-store"
  }).catch(() => undefined);
}

