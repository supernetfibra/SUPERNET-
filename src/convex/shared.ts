/**
 * Shared utilities for Convex backend modules.
 */

/**
 * Generate a cryptographically secure random session token.
 * Used by sessions.ts and admin.ts.
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
