"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error: string | null;
}

function readable(message: string): string {
  const cleaned = message.replace(/^.*?ERROR:\s*/i, "").trim();
  return cleaned.length > 0 ? cleaned : "That did not work. Try again.";
}

function optionalNumber(value: FormDataEntryValue | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function createReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supplierId = String(formData.get("supplier_id") ?? "") || null;
  const waybill = String(formData.get("waybill_no") ?? "").trim() || null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_receipt", {
    p_location_id: String(formData.get("location_id") ?? "") || null,
    p_supplier_id: supplierId,
    p_waybill_no: waybill,
    p_freight: optionalNumber(formData.get("freight")),
    p_duty: optionalNumber(formData.get("duty")),
    p_other: optionalNumber(formData.get("other")),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/receive");
  redirect(`/receive/${data as string}`);
}

export async function setReceiptLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const receiptId = String(formData.get("receipt_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const qty = Number(formData.get("qty"));
  const cost = Number(formData.get("invoice_unit_cost"));

  if (!productId) return { error: "Pick a product." };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Enter how many arrived." };
  if (!Number.isFinite(cost) || cost < 0) {
    return { error: "Enter what each one cost. Unpriced stock makes the valuation wrong." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_receipt_line", {
    p_receipt_id: receiptId,
    p_product_id: productId,
    p_qty: qty,
    p_invoice_unit_cost: cost,
    p_expiry_date: String(formData.get("expiry_date") ?? "") || null,
    p_lot_code: String(formData.get("lot_code") ?? "").trim() || null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath(`/receive/${receiptId}`);
  return { error: null };
}

export async function removeReceiptLine(formData: FormData): Promise<void> {
  const receiptId = String(formData.get("receipt_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");

  const supabase = await createClient();
  await supabase.rpc("set_receipt_line", {
    p_receipt_id: receiptId,
    p_product_id: productId,
    p_qty: 0,
    p_invoice_unit_cost: 0,
    p_expiry_date: String(formData.get("expiry_date") ?? "") || null,
    p_lot_code: String(formData.get("lot_code") ?? "").trim() || null,
  });

  revalidatePath(`/receive/${receiptId}`);
}

export async function setCharges(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const receiptId = String(formData.get("receipt_id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_receipt_charges", {
    p_receipt_id: receiptId,
    p_freight: optionalNumber(formData.get("freight")),
    p_duty: optionalNumber(formData.get("duty")),
    p_other: optionalNumber(formData.get("other")),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath(`/receive/${receiptId}`);
  return { error: null };
}

export async function postReceipt(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const receiptId = String(formData.get("receipt_id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_receipt", {
    p_receipt_id: receiptId,
    p_client_token: randomUUID(),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null };
}

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!sku || !name) return { error: "A product needs a SKU and a name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_product", {
    p_sku: sku,
    p_name: name,
    p_base_unit: String(formData.get("base_unit") ?? "piece").trim() || "piece",
    p_wholesale_price: optionalNumber(formData.get("wholesale_price")) || null,
    p_retail_price: optionalNumber(formData.get("retail_price")) || null,
    p_reorder_point: optionalNumber(formData.get("reorder_point")) || null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null };
}
