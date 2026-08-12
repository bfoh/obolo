import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  CustomerRow,
  LedgerEntryRow,
  PaymentRow,
  SalesOrderLineRow,
  SalesOrderRow,
} from "./types";

export async function getSales(status?: SalesOrderRow["status"]): Promise<SalesOrderRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_sales_orders").select("*");
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("occurred_at", { ascending: false }).limit(100);
  if (error) {
    console.error(`[data] sales: ${error.message}`);
    throw new Error("Could not load sales.");
  }
  return (data ?? []) as SalesOrderRow[];
}

export async function getSale(id: string): Promise<SalesOrderRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_sales_orders").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error(`[data] sale: ${error.message}`);
    return null;
  }
  return data as SalesOrderRow | null;
}

export async function getSaleLines(orderId: string): Promise<SalesOrderLineRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_sales_order_lines")
    .select("*")
    .eq("order_id", orderId)
    .order("product_name");
  if (error) {
    console.error(`[data] sale lines: ${error.message}`);
    return [];
  }
  return (data ?? []) as SalesOrderLineRow[];
}

export async function getCustomers(search?: string): Promise<CustomerRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_customers").select("*").eq("is_active", true);
  if (search?.trim()) {
    const safe = search.trim().replace(/[,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,code.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }
  const { data, error } = await query.order("name").limit(300);
  if (error) {
    console.error(`[data] customers: ${error.message}`);
    return [];
  }
  return (data ?? []) as CustomerRow[];
}

export async function getCustomer(id: string): Promise<CustomerRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_customers").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error(`[data] customer: ${error.message}`);
    return null;
  }
  return data as CustomerRow | null;
}

/** A statement is the ledger in the order it happened, newest first. */
export async function getCustomerLedger(customerId: string): Promise<LedgerEntryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_customer_ledger")
    .select("*")
    .eq("customer_id", customerId)
    .order("seq", { ascending: false })
    .limit(200);
  if (error) {
    console.error(`[data] statement: ${error.message}`);
    return [];
  }
  return (data ?? []) as LedgerEntryRow[];
}

export async function getPayments(customerId?: string): Promise<PaymentRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_payments").select("*");
  if (customerId) query = query.eq("customer_id", customerId);
  const { data, error } = await query.order("received_at", { ascending: false }).limit(100);
  if (error) {
    console.error(`[data] payments: ${error.message}`);
    return [];
  }
  return (data ?? []) as PaymentRow[];
}
