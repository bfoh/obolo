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

export async function createPurchaseOrder(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supplierId = String(formData.get("supplier_id") ?? "");
  if (!supplierId) return { error: "Choose who you are ordering from." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_supplier_id: supplierId,
    p_expected_at: String(formData.get("expected_at") ?? "") || null,
    p_notes: String(formData.get("notes") ?? "").trim() || null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${data as string}`);
}

export async function setPoLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const poId = String(formData.get("po_id") ?? "");
  const qty = Number(formData.get("qty"));

  if (!Number.isFinite(qty) || qty <= 0) return { error: "Enter how many to order." };

  const raw = String(formData.get("unit_cost") ?? "").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_po_line", {
    p_po_id: poId,
    p_product_id: String(formData.get("product_id") ?? ""),
    p_qty: qty,
    // Blank means "whatever it cost last time".
    p_unit_cost: raw === "" ? null : Number(raw),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath(`/purchase-orders/${poId}`);
  return { error: null, ok: true };
}

export async function removePoLine(formData: FormData): Promise<void> {
  const poId = String(formData.get("po_id") ?? "");
  const supabase = await createClient();
  // Zero quantity is how the RPC expresses "drop this line".
  await supabase.rpc("set_po_line", {
    p_po_id: poId,
    p_product_id: String(formData.get("product_id") ?? ""),
    p_qty: 0,
  });
  revalidatePath(`/purchase-orders/${poId}`);
}

export async function setPoStatus(formData: FormData): Promise<void> {
  const poId = String(formData.get("po_id") ?? "");
  const supabase = await createClient();
  await supabase.rpc("set_po_status", {
    p_po_id: poId,
    p_status: String(formData.get("status") ?? ""),
  });
  revalidatePath(`/purchase-orders/${poId}`);
}

export async function receiveAgainstPo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const poId = String(formData.get("po_id") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_receipt_from_po", { p_po_id: poId });

  if (error) return { error: readable(error.message) };

  revalidatePath("/receive");
  redirect(`/receive/${data as string}`);
}
