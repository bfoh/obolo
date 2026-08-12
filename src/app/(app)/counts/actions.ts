"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error: string | null;
  ok?: boolean;
}

function readable(message: string): string {
  const cleaned = message.replace(/^.*?ERROR:\s*/i, "").trim();
  return cleaned.length > 0 ? cleaned : "That did not work. Try again.";
}

export async function startCount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_count", {
    p_location_id: String(formData.get("location_id") ?? ""),
    p_scope: String(formData.get("scope") ?? "full"),
    p_notes: String(formData.get("notes") ?? "").trim() || null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/counts");
  redirect(`/counts/${data as string}`);
}

export async function setCountLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const countId = String(formData.get("count_id") ?? "");
  const counted = Number(formData.get("counted"));

  if (!Number.isFinite(counted) || counted < 0) {
    return { error: "Enter how many are actually there." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_count_line", {
    p_count_id: countId,
    p_product_id: String(formData.get("product_id") ?? ""),
    p_counted: counted,
    p_note: String(formData.get("note") ?? "").trim() || null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath(`/counts/${countId}`);
  return { error: null, ok: true };
}

export async function submitCount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const countId = String(formData.get("count_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_count", { p_count_id: countId });

  if (error) return { error: readable(error.message) };

  revalidatePath(`/counts/${countId}`);
  return { error: null, ok: true };
}

export async function postCount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const countId = String(formData.get("count_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_count", { p_count_id: countId });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null, ok: true };
}

export async function cancelCount(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("cancel_count", { p_count_id: String(formData.get("count_id") ?? "") });
  revalidatePath("/counts");
  redirect("/counts");
}
