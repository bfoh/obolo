import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions";

export interface CurrentUser {
  id: string;
  fullName: string;
  email: string | null;
  role: Role;
  locationIds: string[];
  /**
   * True while the account is still using a password somebody else chose. The
   * app layout refuses to render anything but /password until it clears, so
   * this is a gate rather than a hint.
   */
  mustChangePassword: boolean;
}

/**
 * The signed-in user's profile and role.
 *
 * Wrapped in React's `cache` so the several Server Components that need the
 * role during one render share a single round trip.
 *
 * Returns null when there is no session, or when the session belongs to an
 * auth user with no active `core.app_users` row -- an invited-but-not-yet-
 * provisioned account, or one that was suspended. Callers must treat null as
 * "no access", never as "not loaded yet".
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("me").single();
  if (error || !data) return null;

  const row = data as {
    id: string;
    full_name: string;
    email: string | null;
    role: Role;
    status: string;
    location_ids: string[] | null;
    must_change_password: boolean | null;
  };

  if (row.status !== "active") return null;

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    locationIds: row.location_ids ?? [],
    // Defaults to true, not false. If the column is ever missing or null the
    // safe reading is "this password was not chosen by them".
    mustChangePassword: row.must_change_password ?? true,
  };
});
