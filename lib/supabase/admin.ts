import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client using the secret key. It bypasses Row Level
 * Security, so every caller must check who the user is and what they may
 * access before using it. Never import this from a client component.
 */
export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
