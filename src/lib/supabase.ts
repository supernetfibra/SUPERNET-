/**
 * Supabase Client Configuration
 *
 * This module provides the Supabase client for both client-side and server-side use.
 * - Browser: uses VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public)
 * - Server (Hono): uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (private)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Client-side Supabase client (uses anon key, respects RLS)
let _browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (_browserClient) return _browserClient;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[SUPABASE] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
    throw new Error("Supabase configuration missing. Check your .env file.");
  }

  _browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return _browserClient;
}
