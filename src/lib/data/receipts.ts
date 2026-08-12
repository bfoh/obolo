import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ReceiptLineRow, ReceiptRow, SupplierRow } from "./types";

export async function getReceipts(): Promise<ReceiptRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_receipts")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error(`[data] receipts: ${error.message}`);
    throw new Error("Could not load deliveries.");
  }
  return (data ?? []) as ReceiptRow[];
}

export async function getReceipt(id: string): Promise<ReceiptRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_receipts").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error(`[data] receipt: ${error.message}`);
    return null;
  }
  return data as ReceiptRow | null;
}

export async function getReceiptLines(receiptId: string): Promise<ReceiptLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_receipt_lines")
    .select("*")
    .eq("receipt_id", receiptId)
    .order("product_name");
  if (error) {
    console.error(`[data] receipt lines: ${error.message}`);
    throw new Error("Could not load delivery lines.");
  }
  return (data ?? []) as ReceiptLineRow[];
}

export async function getSuppliers(): Promise<SupplierRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_suppliers")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) {
    console.error(`[data] suppliers: ${error.message}`);
    return [];
  }
  return (data ?? []) as SupplierRow[];
}
