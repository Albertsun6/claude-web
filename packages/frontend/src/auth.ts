// Tiny auth helper: holds a bearer token in localStorage and exposes a fetch
// wrapper + WS URL builder. The token is set via the AuthGate component when
// the backend reports authRequired=true.

const KEY = "claude-web:auth-token";

export function getAuthToken(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function setAuthToken(token: string): void {
  try { localStorage.setItem(KEY, token); } catch { /* ignore */ }
}

export function clearAuthToken(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Fetch wrapper that attaches Authorization: Bearer when a token is set. */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init.headers);
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** Append ?token=... to a URL when a token is set. Used for WS upgrade. */
export function withAuthQuery(rawUrl: string): string {
  const token = getAuthToken();
  if (!token) return rawUrl;
  const sep = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${sep}token=${encodeURIComponent(token)}`;
}
