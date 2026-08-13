/**
 * End-to-end smoke test against the real Supabase project, over PostgREST,
 * with a real user JWT.
 *
 * The migration harness proves the SQL. This proves the parts it shims: that
 * `auth.uid()` resolves from a genuine token, that the masked views are
 * reachable through PostgREST, that `core` is not, and that the RPCs behave the
 * same when called over HTTP as they do in-process.
 *
 *   node scripts/smoke-remote.mjs           # run the flow, then reset
 *   node scripts/smoke-remote.mjs --keep    # leave the test data in place
 *
 * The ledger is append-only, so this cannot tidy up after itself the way a
 * normal test would. It therefore TRUNCATEs the movement and document tables at
 * the end, restoring the pristine state. That is only acceptable because the
 * project has no real data yet -- it must never be run against a live warehouse.
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEEP = process.argv.includes("--keep");

let failures = 0;
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n          expected ${expected}, got ${actual}`}`);
};

async function loadEnv() {
  const raw = await readFile(path.join(ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

async function main() {
  const env = await loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const supabase = createClient(url, anon);

  console.log("Signing in…");
  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email: process.env.OBOLO_EMAIL,
    password: process.env.OBOLO_PASSWORD,
  });
  if (authError) throw new Error(`sign-in failed: ${authError.message}`);
  console.log(`Signed in as ${auth.user.email}\n`);

  console.log("Identity and reference data");
  const { data: me } = await supabase.rpc("me").single();
  // Signed in as whoever OBOLO_EMAIL names -- the owner, or an admin standing
  // in for one. Both resolve to an effective role of owner, which is the thing
  // the rest of this script depends on.
  check("me() resolves the caller from a real JWT", me?.role, process.env.OBOLO_ROLE ?? "owner");
  check("and returns their name", Boolean(me?.full_name), true);
  check("they are assigned to every location", me?.location_ids?.length, 3);

  const { data: isOwner } = await supabase.rpc("is_owner");
  check("is_owner() is true over HTTP", isOwner, "true");

  const { data: locations } = await supabase.from("v_locations").select("*");
  check("v_locations is readable", locations?.length, 3);

  console.log("\nThe core schema is unreachable");
  for (const table of ["stock_movements", "stock_batches", "products", "app_users"]) {
    const { error } = await supabase.from(table).select("*").limit(1);
    check(`core.${table} is not exposed`, error ? "blocked" : "READABLE", "blocked");
  }

  console.log("\nValuation starts empty");
  const { data: summary, error: sumError } = await supabase.rpc("valuation_summary");
  if (sumError) throw new Error(`valuation_summary: ${sumError.message}`);
  check("valuation_summary returns all three locations", summary?.length, 3);
  check("warehouse starts at zero", summary?.find((s) => s.location_code === "WH")?.total_value, "0");

  console.log("\nThe full loop: receive → transfer → confirm");

  const { data: productId, error: prodError } = await supabase.rpc("create_product", {
    p_sku: "SMOKE-RICE",
    p_name: "Smoke test rice",
    p_base_unit: "bag",
    p_wholesale_price: 500,
    p_retail_price: 560,
    p_reorder_point: 10,
  });
  if (prodError) throw new Error(`create_product: ${prodError.message}`);
  check("owner creates a product over HTTP", typeof productId, "string");

  // Two deliveries at different costs, so FIFO has something to choose between.
  for (const [qty, cost, freight] of [[100, 400, 0], [100, 450, 500]]) {
    const { data: grnId, error } = await supabase.rpc("create_receipt", {
      p_supplier_id: null,
      p_waybill_no: `SMOKE-${cost}`,
      p_freight: freight,
    });
    if (error) throw new Error(`create_receipt: ${error.message}`);

    const { error: lineError } = await supabase.rpc("set_receipt_line", {
      p_receipt_id: grnId,
      p_product_id: productId,
      p_qty: qty,
      p_invoice_unit_cost: cost,
    });
    if (lineError) throw new Error(`set_receipt_line: ${lineError.message}`);

    const { error: postError } = await supabase.rpc("post_receipt", { p_receipt_id: grnId });
    if (postError) throw new Error(`post_receipt: ${postError.message}`);
  }

  const wh = locations.find((l) => l.kind === "warehouse");
  const shop = locations.find((l) => l.kind === "retail");

  const { data: level } = await supabase
    .from("v_stock_levels")
    .select("*")
    .eq("product_id", productId)
    .eq("location_id", wh.id)
    .single();

  check("warehouse holds 200 bags", level?.qty_on_hand, 200);
  check("money crosses the wire as text, not a float", typeof level?.total_cost_value, "string");
  // 100@400 + 100@(450 + 500/100 freight = 455) = 40000 + 45500
  check("valued at landed cost, freight included", level?.total_cost_value, "85500.000000");

  const { data: batches } = await supabase
    .from("v_stock_batches")
    .select("*")
    .eq("product_id", productId)
    .eq("location_id", wh.id)
    .order("origin_received_at");
  check("two batches, one per delivery", batches?.length, 2);
  check("the older batch is priced at 400", batches?.[0]?.unit_cost, "400.000000");
  check("the newer batch carries its freight", batches?.[1]?.unit_cost, "455.000000");

  const { data: transferId, error: trfError } = await supabase.rpc("create_transfer", {
    p_from_location_id: wh.id,
    p_to_location_id: shop.id,
    p_notes: "smoke test",
  });
  if (trfError) throw new Error(`create_transfer: ${trfError.message}`);

  await supabase.rpc("set_transfer_line", {
    p_transfer_id: transferId,
    p_product_id: productId,
    p_qty: 150,
  });

  const { error: dispatchError } = await supabase.rpc("post_transfer_dispatch", {
    p_transfer_id: transferId,
  });
  if (dispatchError) throw new Error(`post_transfer_dispatch: ${dispatchError.message}`);

  const { data: afterDispatch } = await supabase
    .from("v_stock_levels")
    .select("*")
    .eq("product_id", productId)
    .eq("location_id", wh.id)
    .single();
  // FIFO takes 100@400 then 50@455; 50@455 remain.
  check("FIFO leaves 50 bags in the warehouse", afterDispatch?.qty_on_hand, 50);
  check("worth 50 x 455, not an average", afterDispatch?.total_cost_value, "22750.000000");

  const { data: lines } = await supabase
    .from("v_transfer_lines")
    .select("*")
    .eq("transfer_id", transferId);
  check("150 bags are in transit", lines?.[0]?.qty_in_transit, 150);

  // Confirm 145 of 150: the short 5 must stay visible rather than vanish.
  const { error: receiveError } = await supabase.rpc("post_transfer_receive", {
    p_transfer_id: transferId,
    p_received: [{ line_id: lines[0].id, qty: 145 }],
  });
  if (receiveError) throw new Error(`post_transfer_receive: ${receiveError.message}`);

  const { data: finalSummary } = await supabase.rpc("valuation_summary");
  const transit = finalSummary.find((s) => s.location_code === "TRANSIT");
  check("5 unconfirmed bags stay parked in transit", transit?.qty_on_hand, 5);
  check("and their value stays on the books", transit?.total_value, "2275.000000");

  const shopRow = finalSummary.find((s) => s.location_code === "SHOP");
  check("the shop received 145 bags", shopRow?.qty_on_hand, 145);

  // Summed here only to assert conservation across locations; the app itself
  // never adds money in JavaScript.
  const total = finalSummary.reduce((sum, row) => sum + Number(row.total_value), 0);
  check("company-wide value is unchanged by the transfer", total, 85500);
  check("valuation_summary sends money as text", typeof finalSummary[0].total_value, "string");

  const { data: findings } = await supabase.rpc("integrity_findings");
  check("all three integrity derivations agree", findings?.length, 0);

  // Oversell, over HTTP this time.
  const { error: oversell } = await supabase.rpc("post_movement", {
    p_type: "retail_sale",
    p_product_id: productId,
    p_location_id: shop.id,
    p_qty: 99999,
  });
  check(
    "overselling is refused over the API too",
    oversell?.message?.includes("insufficient stock") ? "refused" : (oversell?.message ?? "no error"),
    "refused",
  );

  if (!KEEP) {
    console.log("\nResetting to a pristine database…");
    await reset();
    console.log("  done");
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * The ledger refuses UPDATE and DELETE by design, so this drops the rows
 * wholesale. Safe only on a database with no real history.
 */
async function reset() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(`
      truncate
        core.movement_batch_allocations,
        core.stock_movements,
        core.stock_batches,
        core.stock_levels,
        core.receipt_lines,
        core.receipts,
        core.transfer_lines,
        core.transfers,
        core.stock_snapshots,
        core.integrity_check_log,
        core.products
      restart identity cascade;
      alter sequence core.grn_number_seq restart with 1;
      alter sequence core.transfer_number_seq restart with 1;
      alter sequence core.po_number_seq restart with 1;
    `);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\n" + error.message);
  process.exit(1);
});
