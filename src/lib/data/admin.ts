import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AppSettingsRow, TeamMemberRow } from "./types";

export async function getSettings(): Promise<AppSettingsRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("app_settings").single();
  if (error) {
    console.error(`[data] settings: ${error.message}`);
    return null;
  }
  return data as AppSettingsRow;
}

/** Owner-only; the RPC raises for anyone else, which surfaces as an empty team. */
export async function getTeam(): Promise<TeamMemberRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team");
  if (error) {
    console.error(`[data] team: ${error.message}`);
    return [];
  }
  return (data ?? []) as TeamMemberRow[];
}
