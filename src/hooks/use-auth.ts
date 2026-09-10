/**
 * Re-export useAuth from auth-context for backward compatibility.
 * Previously this used Convex auth (@convex-dev/auth/react), but now uses
 * the custom MikWeb session-based auth from auth-context.
 */

export { useAuth } from "@/lib/auth-context";
