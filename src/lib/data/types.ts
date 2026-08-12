/**
 * Row shapes for the `public.v_*` views and the RPCs the app reads.
 *
 * Hand-written rather than generated, because `supabase gen types` needs a
 * linked project. Once linked, replace this with generated types and keep the
 * masking convention below.
 *
 * MASKING CONVENTION: every cost-bearing field is typed `string | null`. The
 * null is not "missing data" -- it is what a staff caller receives, because the
 * view returns `case when is_owner() then ... end`. Typing these as
 * non-nullable would let a component render `₵0.00` and claim the stock is
 * worthless.
 *
 * WIRE FORMAT: money is text and quantities are numbers, which is not the
 * default and is not an accident -- see migration 23. Money stays a string all
 * the way to the formatter; nothing here is ever parsed into a float and summed.
 * Totals come from SQL.
 */

/**
 * Money and cost. Cast to text in the view (migration 23) so the exact decimal
 * survives the wire -- PostgREST serialises `numeric` as a JSON number, which
 * becomes a float64 and stops agreeing with the ledger once you sum it.
 */
export type Money = string;
/** A cost value: null when the caller is not an owner. */
export type MaskedMoney = string | null;
/**
 * Quantities stay JSON numbers. numeric(14,3) scaled to an integer tops out
 * around 1e14, well inside float64's exact range, and they must remain numeric
 * so PostgREST can still filter and order on them.
 */
export type Qty = number;

export interface LocationRow {
  id: string;
  code: string;
  name: string;
  kind: "warehouse" | "retail" | "in_transit";
  is_active: boolean;
}

export interface ValuationSummaryRow {
  location_id: string;
  location_code: string;
  location_name: string;
  location_kind: "warehouse" | "retail" | "in_transit";
  qty_on_hand: Qty;
  total_value: MaskedMoney;
  product_count: number;
}

export interface StockLevelRow {
  product_id: string;
  sku: string;
  product_name: string;
  base_unit: string;
  location_id: string;
  location_code: string;
  location_kind: "warehouse" | "retail" | "in_transit";
  qty_on_hand: Qty;
  total_cost_value: MaskedMoney;
  avg_unit_cost: MaskedMoney;
  reorder_point: Qty | null;
  updated_at: string;
}

export interface StockBatchRow {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  lot_code: string | null;
  qty_received: Qty;
  qty_remaining: Qty;
  unit_cost: MaskedMoney;
  remaining_value: MaskedMoney;
  origin_received_at: string;
  received_at: string;
  expiry_date: string | null;
  parent_batch_id: string | null;
  supplier_id: string | null;
}

export type MovementType =
  | "opening_balance"
  | "receipt"
  | "transfer_out"
  | "transfer_in"
  | "wholesale_sale"
  | "retail_sale"
  | "customer_return"
  | "supplier_return"
  | "damage"
  | "expiry_writeoff"
  | "count_increase"
  | "count_decrease";

export interface StockMovementRow {
  id: string;
  seq: number;
  type: MovementType;
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  qty_delta: Qty;
  value_delta: MaskedMoney;
  unit_price: Money | null;
  movement_group_id: string;
  reverses_movement_id: string | null;
  is_reversed: boolean;
  reason: string | null;
  occurred_at: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  base_unit: string;
  pack_unit: string | null;
  units_per_pack: Qty | null;
  wholesale_price: Money | null;
  retail_price: Money | null;
  last_cost: MaskedMoney;
  avg_cost: MaskedMoney;
  reorder_point: Qty | null;
  reorder_qty: Qty | null;
  track_expiry: boolean;
  shelf_life_days: number | null;
  is_active: boolean;
}

export interface LowStockRow {
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  qty_on_hand: Qty;
  reorder_point: Qty;
  reorder_qty: Qty | null;
}

export interface ExpiringRow {
  batch_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  lot_code: string | null;
  qty_remaining: Qty;
  at_risk_value: MaskedMoney;
  expiry_date: string;
  days_remaining: number;
}

export interface TransferRow {
  id: string;
  transfer_no: string;
  from_location_id: string;
  from_code: string;
  to_location_id: string;
  to_code: string;
  status: "draft" | "dispatched" | "received" | "cancelled";
  dispatched_at: string | null;
  received_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface TransferLineRow {
  id: string;
  transfer_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  base_unit: string;
  qty_requested: Qty;
  qty_dispatched: Qty;
  qty_received: Qty;
  qty_in_transit: Qty;
}

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  payment_terms_days: number;
  currency: string;
  is_active: boolean;
}

export interface ReceiptRow {
  id: string;
  grn_no: string;
  po_id: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  location_id: string;
  location_code: string;
  status: "draft" | "posted" | "reversed";
  waybill_no: string | null;
  received_at: string;
  freight_total: MaskedMoney;
  duty_total: MaskedMoney;
  other_total: MaskedMoney;
  /** Summed in SQL, so the draft screen never adds up lines in the browser. */
  charges_total: MaskedMoney;
  goods_total: MaskedMoney;
  landed_total: MaskedMoney;
  line_count: number;
  posted_at: string | null;
}

export interface LocationTotalsRow {
  product_count: number;
  total_qty: Qty;
  total_value: MaskedMoney;
}

export interface ReceiptLineRow {
  id: string;
  receipt_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  qty_received: Qty;
  invoice_unit_cost: MaskedMoney;
  allocated_charges: MaskedMoney;
  landed_unit_cost: MaskedMoney;
  expiry_date: string | null;
  lot_code: string | null;
  batch_id: string | null;
}
