import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  ExpiringRow,
  LocationRow,
  LocationTotalsRow,
  LowStockRow,
  ProductRow,
  StockBatchRow,
  StockLevelRow,
  StockMovementRow,
  ValuationSummaryRow,
} from "./types";

/**
 * Reads for the stock screens.
 *
 * Every one of these goes through a `public.v_*` view or an RPC, never a base
 * table -- `core` is not served by PostgREST, so there is nothing else to read.
 * Cost masking happens inside the view, which means a staff request never
 * carries a cost value over the wire at all, rather than being hidden in the UI.
 *
 * server-only: importing any of this from a Client Component is a build error.
 * These run with the caller's session, so leaking one into the browser bundle
 * would be leaking the query, not just the data.
 */

/** Postgres errors are opaque to users; log the detail, surface the shape. */
function unwrap<T>(data: T | null, error: { message: string } | null, what: string): T {
  if (error) {
    console.error(`[data] ${what}: ${error.message}`);
    throw new Error(`Could not load ${what}.`);
  }
  return (data ?? []) as T;
}

export async function getValuationSummary(at?: Date): Promise<ValuationSummaryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("valuation_summary", {
    p_at: (at ?? new Date()).toISOString(),
  });
  return unwrap<ValuationSummaryRow[]>(data, error, "valuation");
}

/**
 * Totals for one location.
 *
 * Summed in SQL rather than by reducing the rows in JavaScript: money crosses
 * the wire as text precisely so it is not float64, and adding it up in the
 * browser would throw that away.
 */
export async function getLocationTotals(locationId: string): Promise<LocationTotalsRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("location_stock_totals", { p_location_id: locationId })
    .single();

  if (error || !data) {
    console.error(`[data] location totals: ${error?.message}`);
    return { product_count: 0, total_qty: 0, total_value: null };
  }
  return data as LocationTotalsRow;
}

export async function getLocations(): Promise<LocationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_locations")
    .select("*")
    .order("kind")
    .order("code");
  return unwrap<LocationRow[]>(data, error, "locations");
}

export async function getLocationByCode(code: string): Promise<LocationRow | null> {
  const locations = await getLocations();
  return locations.find((l) => l.code === code) ?? null;
}

export async function getStockLevels(locationId: string, search?: string): Promise<StockLevelRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("v_stock_levels")
    .select("*")
    .eq("location_id", locationId)
    .gt("qty_on_hand", 0);

  if (search && search.trim()) {
    // Escape PostgREST's `or` delimiters so a comma or paren in the search box
    // cannot break out of the filter expression.
    const term = search.trim().replace(/[,()]/g, " ");
    query = query.or(`product_name.ilike.%${term}%,sku.ilike.%${term}%`);
  }

  const { data, error } = await query.order("product_name").limit(500);
  return unwrap<StockLevelRow[]>(data, error, "stock levels");
}

export async function getStockLevel(
  productId: string,
  locationId: string,
): Promise<StockLevelRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_stock_levels")
    .select("*")
    .eq("product_id", productId)
    .eq("location_id", locationId)
    .maybeSingle();
  if (error) {
    console.error(`[data] stock level: ${error.message}`);
    return null;
  }
  return data as StockLevelRow | null;
}

/**
 * The batches behind a product's position at one location, oldest first.
 *
 * Ordered by origin_received_at because that is the FIFO key -- it is the order
 * these units will actually be consumed in, which is what the Batch Column
 * shows.
 */
export async function getBatches(productId: string, locationId: string): Promise<StockBatchRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_stock_batches")
    .select("*")
    .eq("product_id", productId)
    .eq("location_id", locationId)
    .gt("qty_remaining", 0)
    .order("origin_received_at")
    .order("id");
  return unwrap<StockBatchRow[]>(data, error, "batches");
}

export async function getProduct(productId: string): Promise<ProductRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_products")
    .select("*")
    .eq("id", productId)
    .maybeSingle();
  if (error) {
    console.error(`[data] product: ${error.message}`);
    return null;
  }
  return data as ProductRow | null;
}

export async function searchProducts(term: string, limit = 20): Promise<ProductRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_products").select("*").eq("is_active", true);

  if (term.trim()) {
    const safe = term.trim().replace(/[,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
  }

  const { data, error } = await query.order("name").limit(limit);
  return unwrap<ProductRow[]>(data, error, "products");
}

export async function getMovements(options: {
  productId?: string;
  locationId?: string;
  limit?: number;
}): Promise<StockMovementRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_stock_movements").select("*");

  if (options.productId) query = query.eq("product_id", options.productId);
  if (options.locationId) query = query.eq("location_id", options.locationId);

  const { data, error } = await query.order("seq", { ascending: false }).limit(options.limit ?? 50);
  return unwrap<StockMovementRow[]>(data, error, "movement history");
}

export async function getLowStock(locationId?: string): Promise<LowStockRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_low_stock").select("*");
  if (locationId) query = query.eq("location_id", locationId);
  const { data, error } = await query.order("qty_on_hand").limit(100);
  return unwrap<LowStockRow[]>(data, error, "low stock");
}

export async function getExpiringSoon(locationId?: string): Promise<ExpiringRow[]> {
  const supabase = await createClient();
  let query = supabase.from("v_expiring_soon").select("*");
  if (locationId) query = query.eq("location_id", locationId);
  const { data, error } = await query.order("expiry_date").limit(100);
  return unwrap<ExpiringRow[]>(data, error, "expiring stock");
}
