"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { MaskedMoney, Money, Qty } from "@/lib/data/types";

export interface ScanResult {
  found: boolean;
  barcode: string;
  product_id?: string;
  sku?: string;
  product_name?: string;
  unit?: string;
  base_unit?: string;
  qty_on_hand?: Qty;
  stock_value?: MaskedMoney;
  retail_price?: Money | null;
  wholesale_price?: Money | null;
}

export async function lookupBarcode(barcode: string, locationId: string): Promise<ScanResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("lookup_barcode", { p_barcode: barcode, p_location_id: locationId })
    .maybeSingle();

  if (error || !data) {
    // An unrecognised code is an ordinary outcome, not a failure.
    return { found: false, barcode };
  }

  return { found: true, barcode, ...(data as object) } as ScanResult;
}

export interface BarcodeActionState {
  error: string | null;
  ok?: boolean;
}

export async function addBarcode(
  _prev: BarcodeActionState,
  formData: FormData,
): Promise<BarcodeActionState> {
  const productId = String(formData.get("product_id") ?? "");
  const barcode = String(formData.get("barcode") ?? "").trim();

  if (!barcode) return { error: "Scan or type the barcode." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_product_barcode", {
    p_product_id: productId,
    p_barcode: barcode,
    p_unit: String(formData.get("unit") ?? "").trim() || null,
    p_is_primary: formData.get("is_primary") === "on",
  });

  if (error) {
    return { error: error.message.replace(/^.*?ERROR:\s*/i, "").trim() || "Could not save that code." };
  }

  revalidatePath(`/products/${productId}`);
  return { error: null, ok: true };
}

export async function removeBarcode(formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("remove_product_barcode", {
    p_barcode: String(formData.get("barcode") ?? ""),
  });
  revalidatePath(`/products/${String(formData.get("product_id") ?? "")}`);
}
