import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ReturnLineRow, ReturnRow, StockCountLineRow, StockCountRow } from "./types";

export async function getCounts(): Promise<StockCountRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_stock_counts")
    .select("*")
    .order("frozen_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error(`[data] counts: ${error.message}`);
    return [];
  }
  return (data ?? []) as StockCountRow[];
}

export async function getCount(id: string): Promise<StockCountRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_stock_counts").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error(`[data] count: ${error.message}`);
    return null;
  }
  return data as StockCountRow | null;
}

export async function getCountLines(countId: string): Promise<StockCountLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_stock_count_lines")
    .select("*")
    .eq("count_id", countId)
    .order("product_name");
  if (error) {
    console.error(`[data] count lines: ${error.message}`);
    return [];
  }
  return (data ?? []) as StockCountLineRow[];
}

export async function getReturns(): Promise<ReturnRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_returns")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error(`[data] returns: ${error.message}`);
    return [];
  }
  return (data ?? []) as ReturnRow[];
}

export async function getReturn(id: string): Promise<ReturnRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_returns").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error(`[data] return: ${error.message}`);
    return null;
  }
  return data as ReturnRow | null;
}

export async function getReturnLines(returnId: string): Promise<ReturnLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_return_lines")
    .select("*")
    .eq("return_id", returnId)
    .order("product_name");
  if (error) {
    console.error(`[data] return lines: ${error.message}`);
    return [];
  }
  return (data ?? []) as ReturnLineRow[];
}
