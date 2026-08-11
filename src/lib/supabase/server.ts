import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Must be created per request -- never module-scoped -- because it closes over
 * that request's cookies. A shared instance would serve one user's session to
 * another.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies. Token refresh is handled by
            // proxy.ts, which can, so ignoring this here is safe.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for server-side work that has no user session: nightly snapshots,
 * integrity checks, scheduled AI insight generation. Never construct this in
 * response to a user request without first checking the caller's role -- and
 * prefer a SECURITY DEFINER RPC, which keeps the authorization decision in the
 * database next to the data it guards.
 */
export function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: {
      getAll: () => [],
      setAll: () => {},
    },
  });
}
