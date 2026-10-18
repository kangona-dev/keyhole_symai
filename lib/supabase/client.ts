import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client, signed in with the user's session cookies. Only used
 * for Realtime: tables have RLS with no public policies, so it can't read data.
 */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
