export function normalizeBackendBaseUrl(value: string | null | undefined, fallback = "") {
  const candidate = String(value || fallback || "").trim().replace(/\/+$/g, "");
  if (!candidate) {
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid backend base URL: ${candidate}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Backend base URL must use http or https.");
  }

  return parsed.toString().replace(/\/+$/g, "");
}

export function joinBackendUrl(baseUrl: string, path = "", query = "") {
  const normalizedBase = normalizeBackendBaseUrl(baseUrl);
  const normalizedPath = path ? `/${String(path).replace(/^\/+/g, "")}` : "";
  const normalizedQuery = query && query.startsWith("?") ? query : query ? `?${query}` : "";
  return `${normalizedBase}${normalizedPath}${normalizedQuery}`;
}

export function toWebSocketBaseUrl(baseUrl: string) {
  const normalizedBase = normalizeBackendBaseUrl(baseUrl);
  return normalizedBase.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}
