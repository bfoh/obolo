"use server";

import { randomUUID } from "node:crypto";
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

export async function createReturn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_return", {
    p_customer_id: String(formData.get("customer_id") ?? "") || null,
    p_location_id: String(formData.get("location_id") ?? "") || null,
    p_reason: String(formData.get("reason") ?? "").trim() || null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/returns");
  redirect(`/returns/${data as string}`);
}

export async function setReturnLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const returnId = String(formData.get("return_id") ?? "");
  const qty = Number(formData.get("qty"));

  if (!Number.isFinite(qty) || qty <= 0) return { error: "Enter how many came back." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_return_line", {
    p_return_id: returnId,
    p_product_id: String(formData.get("product_id") ?? ""),
    p_qty: qty,
    p_condition: String(formData.get("condition") ?? "resalable"),
    p_unit_price: formData.get("unit_price") ? Number(formData.get("unit_price")) : null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath(`/returns/${returnId}`);
  return { error: null, ok: true };
}

export async function postReturn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const returnId = String(formData.get("return_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_return", { p_return_id: returnId });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null, ok: true };
}

export async function writeOffStock(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const qty = Number(formData.get("qty"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isFinite(qty) || qty <= 0) return { error: "Enter how many." };
  if (!reason) return { error: "Say what happened to this stock." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("write_off_stock", {
    p_product_id: String(formData.get("product_id") ?? ""),
    p_location_id: String(formData.get("location_id") ?? ""),
    p_qty: qty,
    p_reason: reason,
    p_expired: formData.get("expired") === "on",
    p_client_token: randomUUID(),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null, ok: true };
}
