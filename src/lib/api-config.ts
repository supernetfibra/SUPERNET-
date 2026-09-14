/**
 * API Configuration — points to the Supabase Edge Function backend.
 *
 * The backend runs as a Supabase Edge Function ("api"), so in production the  * frontend calls `https://ssvwlbwsprjpfmevdnvb.supabase.co/functions/v1/api/...`.
 * Cross-origin requests can't rely on cookies, so authenticated calls go
 * through `authFetch`, which attaches the session token as a header.
 *
 * The backend answers with permissive CORS (see supabase/functions/api/index.ts).
 */

function getApiBaseUrl(): string {
  // Explicit override (e.g. local dev with `supabase functions serve`)
  const customUrl = import.meta.env.VITE_API_URL;
  if (customUrl) return customUrl.replace(/\/$/, "");

  // Production: Supabase Edge Functions
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (supabaseUrl) return `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;

  // Fallback: same origin (backend proxied by the dev server / same host)
  return "";
}

export const API_BASE_URL = getApiBaseUrl();

/**
 * Build a full API URL for a given path.
 * The path must start with /api/ — e.g. apiUrl("/api/mikweb/me").
 */
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

// ---------------------------------------------------------------------------
// Session token storage — the backend is cross-origin, so tokens live in
// localStorage and travel via headers (cookies don't work cross-origin).
// ---------------------------------------------------------------------------

const SESSION_TOKEN_KEY = "mikweb_session_token";

export function storeSessionToken(token: string): void {
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {}
}

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {}
}

/**
 * fetch wrapper that sends the customer session token as a header.
 * Drop-in replacement for fetch for all /api/mikweb/* and /api/push/* calls.
 */
export function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getSessionToken();
  if (token) headers.set("x-session-token", token);
  return fetch(apiUrl(path), { ...init, headers, credentials: "include" });
}
