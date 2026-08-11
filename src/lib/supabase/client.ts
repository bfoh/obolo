import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components.
 *
 * Reads go through `public.v_*` views and writes go through RPCs, so this
 * client is mostly used for auth and realtime subscriptions. Anything that
 * touches cost belongs on the server.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
