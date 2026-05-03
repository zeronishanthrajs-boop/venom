export type VenomSession = {
  email: string;
  role: string;
  apiKey: string;
};

const STORAGE_KEY = "venom_session";

export function loadSession(): VenomSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as VenomSession;
    if (!parsed.email || !parsed.role || !parsed.apiKey) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: VenomSession) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
}
