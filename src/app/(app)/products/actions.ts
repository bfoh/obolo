"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error: string | null;
  ok?: boolean;
}

function readable(message: string): string {
  const cleaned = message.replace(/^.*?ERROR:\s*/i, "").trim();
  if (cleaned.includes("products_sku_key")) return "That SKU is already in use.";
  return cleaned.length > 0 ? cleaned : "That did not work. Try again.";
}

/** Blank optional number inputs mean "not set", not zero. */
function optionalNumber(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!sku) return { error: "Give the product a SKU — it is how you will find it." };
  if (!name) return { error: "Give the product a name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_product", {
    p_sku: sku,
    p_name: name,
    p_base_unit: String(formData.get("base_unit") ?? "piece").trim() || "piece",
    p_wholesale_price: optionalNumber(formData.get("wholesale_price")),
    p_retail_price: optionalNumber(formData.get("retail_price")),
    p_reorder_point: optionalNumber(formData.get("reorder_point")),
    p_reorder_qty: optionalNumber(formData.get("reorder_qty")),
    p_track_expiry: formData.get("track_expiry") === "on",
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/products");
  return { error: null, ok: true };
}

export async function updateProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const productId = String(formData.get("product_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!name) return { error: "Give the product a name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_product", {
    p_product_id: productId,
    p_name: name,
    p_wholesale_price: optionalNumber(formData.get("wholesale_price")),
    p_retail_price: optionalNumber(formData.get("retail_price")),
    p_reorder_point: optionalNumber(formData.get("reorder_point")),
    p_reorder_qty: optionalNumber(formData.get("reorder_qty")),
    p_base_unit: String(formData.get("base_unit") ?? "").trim() || null,
    p_track_expiry: formData.get("track_expiry") === "on",
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/products");
  revalidatePath(`/stock/${productId}`);
  return { error: null, ok: true };
}

export async function setProductActive(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("set_product_active", {
    p_product_id: String(formData.get("product_id") ?? ""),
    p_active: formData.get("active") === "true",
  });
  revalidatePath("/products");
}

export async function createSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!code || !name) return { error: "A supplier needs a short code and a name." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_supplier", {
    p_code: code,
    p_name: name,
    p_phone: String(formData.get("phone") ?? "").trim() || null,
    p_email: String(formData.get("email") ?? "").trim() || null,
  });

  if (error) return { error: readable(error.message) };

  revalidatePath("/suppliers");
  return { error: null, ok: true };
}
