"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { isOwner } from "@/lib/permissions";

export interface ActionState {
  error: string | null;
  ok?: boolean;
  notice?: string | null;
}

function readable(message: string): string {
  const cleaned = message.replace(/^.*?ERROR:\s*/i, "").trim();
  return cleaned.length > 0 ? cleaned : "That did not work. Try again.";
}

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const days = Number(formData.get("expiry_alert_days"));

  const { error } = await supabase.rpc("update_app_settings", {
    p_company_name: String(formData.get("company_name") ?? "").trim() || null,
    p_tin: String(formData.get("tin") ?? "").trim() || null,
    p_address: String(formData.get("address") ?? "").trim() || null,
    p_phone: String(formData.get("phone") ?? "").trim() || null,
    p_expiry_alert_days: Number.isFinite(days) ? days : null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null, ok: true, notice: "Settings saved." };
}

/**
 * Adds a teammate.
 *
 * Two steps, and both are gated. The Auth admin API is the only way to create
 * an account, and it needs the service role -- which bypasses RLS entirely, so
 * the caller's role is checked here before that client is ever constructed.
 * `add_team_member` then checks `is_owner()` again in the database, so neither
 * half is a way in on its own.
 */
export async function addTeamMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await getCurrentUser();
  if (!isOwner(me?.role)) {
    return { error: "Only an owner can add someone to the team." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "");
  const locationIds = formData.getAll("location_ids").map(String).filter(Boolean);

  if (!email || !fullName) return { error: "Enter their name and email." };
  if (password.length < 8) return { error: "Give them a password of at least 8 characters." };
  if (role !== "warehouse_staff" && role !== "retail_staff" && role !== "owner") {
    return { error: "Choose a role." };
  }
  if (role !== "owner" && locationIds.length === 0) {
    return { error: "Choose at least one location they work at." };
  }

  const admin = createServiceRoleClient();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let userId = created?.user?.id;

  if (authError) {
    // Already has an account: reuse it rather than failing, so a person who
    // once worked here can be given a role again.
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
    if (!existing) return { error: readable(authError.message) };
    userId = existing.id;
  }

  if (!userId) return { error: "Could not create that account." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_team_member", {
    p_user_id: userId,
    p_full_name: fullName,
    p_email: email,
    p_role: role,
    p_location_ids: locationIds,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/settings");
  return { error: null, ok: true, notice: `${fullName} can now sign in.` };
}

export async function updateTeamMember(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("update_team_member", {
    p_user_id: String(formData.get("user_id") ?? ""),
    p_status: String(formData.get("status") ?? "") || null,
  });
  revalidatePath("/settings");
}
