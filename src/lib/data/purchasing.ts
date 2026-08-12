import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PurchaseOrderLineRow, PurchaseOrderRow } from "./types";

export async function getPurchaseOrders(): Promise<PurchaseOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_purchase_orders")
    .select("*")
    .order("ordered_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) {
    console.error(`[data] purchase orders: ${error.message}`);
    return [];
  }
  return (data ?? []) as PurchaseOrderRow[];
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_purchase_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error(`[data] purchase order: ${error.message}`);
    return null;
  }
  return data as PurchaseOrderRow | null;
}

export async function getPurchaseOrderLines(poId: string): Promise<PurchaseOrderLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_purchase_order_lines")
    .select("*")
    .eq("po_id", poId)
    .order("product_name");
  if (error) {
    console.error(`[data] purchase order lines: ${error.message}`);
    return [];
  }
  return (data ?? []) as PurchaseOrderLineRow[];
}
