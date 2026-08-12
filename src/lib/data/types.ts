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
 * Postgres `numeric` arrives as a string to preserve precision. It stays a
 * string all the way to the formatter; nothing here is ever parsed into a
 * float and added up.
 */

export type Numeric = string;
/** A cost value: null when the caller is not an owner. */
export type MaskedNumeric = string | null;

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
  qty_on_hand: Numeric;
  total_value: MaskedNumeric;
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
  qty_on_hand: Numeric;
  total_cost_value: MaskedNumeric;
  avg_unit_cost: MaskedNumeric;
  reorder_point: Numeric | null;
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
  qty_received: Numeric;
  qty_remaining: Numeric;
  unit_cost: MaskedNumeric;
  remaining_value: MaskedNumeric;
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
  qty_delta: Numeric;
  value_delta: MaskedNumeric;
  unit_price: Numeric | null;
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
  units_per_pack: Numeric | null;
  wholesale_price: Numeric | null;
  retail_price: Numeric | null;
  last_cost: MaskedNumeric;
  avg_cost: MaskedNumeric;
  reorder_point: Numeric | null;
  reorder_qty: Numeric | null;
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
  qty_on_hand: Numeric;
  reorder_point: Numeric;
  reorder_qty: Numeric | null;
}

export interface ExpiringRow {
  batch_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  location_id: string;
  location_code: string;
  lot_code: string | null;
  qty_remaining: Numeric;
  at_risk_value: MaskedNumeric;
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
  qty_requested: Numeric;
  qty_dispatched: Numeric;
  qty_received: Numeric;
  qty_in_transit: Numeric;
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
  freight_total: MaskedNumeric;
  duty_total: MaskedNumeric;
  other_total: MaskedNumeric;
  posted_at: string | null;
}

export interface ReceiptLineRow {
  id: string;
  receipt_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  qty_received: Numeric;
  invoice_unit_cost: MaskedNumeric;
  allocated_charges: MaskedNumeric;
  landed_unit_cost: MaskedNumeric;
  expiry_date: string | null;
  lot_code: string | null;
  batch_id: string | null;
}
