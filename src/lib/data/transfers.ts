import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { TransferLineRow, TransferRow } from "./types";

export async function getTransfers(status?: TransferRow["status"]): Promise<TransferRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_transfers").select("*");
  if (status) query = query.eq("status", status);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) {
    console.error(`[data] transfers: ${error.message}`);
    throw new Error("Could not load transfers.");
  }
  return (data ?? []) as TransferRow[];
}

export async function getTransfer(id: string): Promise<TransferRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_transfers").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error(`[data] transfer: ${error.message}`);
    return null;
  }
  return data as TransferRow | null;
}

export async function getTransferLines(transferId: string): Promise<TransferLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_transfer_lines")
    .select("*")
    .eq("transfer_id", transferId)
    .order("product_name");
  if (error) {
    console.error(`[data] transfer lines: ${error.message}`);
    throw new Error("Could not load transfer lines.");
  }
  return (data ?? []) as TransferLineRow[];
}
