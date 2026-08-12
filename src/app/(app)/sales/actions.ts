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
  if (cleaned.includes("customers_code_key")) return "That customer code is already in use.";
  return cleaned.length > 0 ? cleaned : "That did not work. Try again.";
}

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function createSale(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const channel = String(formData.get("channel") ?? "retail");
  const customerId = String(formData.get("customer_id") ?? "") || null;
  const dueDate = String(formData.get("due_date") ?? "").trim() || null;

  if (channel === "wholesale" && !customerId) {
    return { error: "A wholesale sale needs a customer." };
  }
  if (dueDate && !customerId) {
    return { error: "Credit needs a named customer — there is no anonymous credit." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sale", {
    p_channel: channel,
    p_customer_id: customerId,
    p_due_date: dueDate,
    p_notes: String(formData.get("notes") ?? "").trim() || null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/sales");
  redirect(`/sales/${data as string}`);
}

export async function setSaleLine(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = String(formData.get("order_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const qty = Number(formData.get("qty"));

  if (!productId) return { error: "Pick a product." };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Enter how many." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sale_line", {
    p_order_id: orderId,
    p_product_id: productId,
    p_qty: qty,
    // Blank means "use the list price for this channel".
    p_unit_price: optionalNumber(formData.get("unit_price")),
    p_discount: optionalNumber(formData.get("discount")) ?? 0,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath(`/sales/${orderId}`);
  return { error: null, ok: true };
}

export async function removeSaleLine(formData: FormData): Promise<void> {
  const orderId = String(formData.get("order_id") ?? "");
  const supabase = await createClient();
  await supabase.rpc("set_sale_line", {
    p_order_id: orderId,
    p_product_id: String(formData.get("product_id") ?? ""),
    p_qty: 0,
  });
  revalidatePath(`/sales/${orderId}`);
}

export async function postSale(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = String(formData.get("order_id") ?? "");
  const paidNow = optionalNumber(formData.get("paid_now")) ?? 0;

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_sale", {
    p_order_id: orderId,
    p_paid_now: paidNow,
    p_pay_method: String(formData.get("pay_method") ?? "cash"),
    // A retried submit must not sell the stock twice.
    p_client_token: randomUUID(),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/", "layout");
  return { error: null, ok: true };
}

export async function cancelSale(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("cancel_sale", { p_order_id: String(formData.get("order_id") ?? "") });
  revalidatePath("/sales");
  redirect("/sales");
}

export async function createCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!code || !name) return { error: "A customer needs a short code and a name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_customer", {
    p_code: code,
    p_name: name,
    p_phone: String(formData.get("phone") ?? "").trim() || null,
    p_email: String(formData.get("email") ?? "").trim() || null,
    p_kind: String(formData.get("kind") ?? "wholesale"),
    p_credit_limit: optionalNumber(formData.get("credit_limit")) ?? 0,
    p_payment_terms_days: optionalNumber(formData.get("payment_terms_days")) ?? 0,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/customers");
  return { error: null, ok: true };
}

export async function recordPayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const customerId = String(formData.get("customer_id") ?? "");
  const amount = Number(formData.get("amount"));

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter how much they paid." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_customer_id: customerId,
    p_amount: amount,
    p_method: String(formData.get("method") ?? "cash"),
    p_reference: String(formData.get("reference") ?? "").trim() || null,
    p_order_id: String(formData.get("order_id") ?? "") || null,
    p_client_token: randomUUID(),
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/customers");
  revalidatePath("/sales");
  return { error: null, ok: true };
}

export async function reversePayment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why this payment is being reversed." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_payment", {
    p_payment_id: String(formData.get("payment_id") ?? ""),
    p_reason: reason,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/customers");
  return { error: null, ok: true };
}
