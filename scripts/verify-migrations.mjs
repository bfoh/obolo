/**
 * Runs every migration against a real Postgres, then exercises the ledger.
 *
 * This exists because the FIFO/valuation core is the part of OBOLO that must be
 * provably right, and `supabase db reset` needs Docker. embedded-postgres ships
 * a real Postgres binary inside node_modules, so the migrations can be proven
 * to apply and behave without any system install.
 *
 * It is not a substitute for `supabase db reset` -- it shims the pieces of a
 * Supabase database that migrations depend on (the auth schema, the client
 * roles, the extensions schema) rather than being one. What it does prove is
 * that the SQL is valid, ordered correctly, idempotent, and that the ledger
 * arithmetic is right.
 *
 *   node scripts/verify-migrations.mjs
 */
import EmbeddedPostgres from "embedded-postgres";
import { readdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const DATA_DIR = path.join(ROOT, ".pgdata");

let failures = 0;
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n          expected ${expected}, got ${actual}`}`);
};

// Minimal stand-ins for the parts of a Supabase database that migrations
// assume already exist.
const SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema if not exists extensions;
  create schema if not exists auth;
  create table auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text unique
  );
  -- Real auth.uid() reads the request JWT. Here it reads a GUC so the harness
  -- can act as different users.
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
`;

async function main() {
  await rm(DATA_DIR, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: 54999,
    persistent: false,
  });

  console.log("Starting Postgres…");
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("obolo");

  const db = pg.getPgClient("obolo");
  await db.connect();

  try {
    await db.query(SHIM);

    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
    console.log(`\nApplying ${files.length} migrations…`);
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS, file), "utf8");
      try {
        await db.query(sql);
        console.log(`  ok    ${file}`);
      } catch (error) {
        console.error(`  FAIL  ${file}\n        ${error.message}`);
        if (error.hint) console.error(`        hint: ${error.hint}`);
        throw error;
      }
    }

    // Re-applying every migration must be a no-op. Migrations get re-run in
    // practice, and one that is not idempotent fails at the worst moment.
    console.log("\nRe-applying all migrations (idempotency)…");
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS, file), "utf8");
      try {
        await db.query(sql);
      } catch (error) {
        console.error(`  FAIL  ${file} is not idempotent\n        ${error.message}`);
        throw error;
      }
    }
    console.log("  ok    all migrations re-applied cleanly");

    await runLedgerTests(db);
  } finally {
    await db.end();
    await pg.stop();
    await rm(DATA_DIR, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

async function runLedgerTests(db) {
  console.log("\nLedger behaviour");

  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const asUser = async (id) => db.query("select set_config('test.uid', $1, false)", [id]);

  // --- fixtures -----------------------------------------------------------
  const owner = await one(
    "insert into auth.users (email) values ('owner@obolo.test') returning id",
  );
  const staff = await one(
    "insert into auth.users (email) values ('wh@obolo.test') returning id",
  );

  await asUser(owner.id);
  await db.query("select public.bootstrap_owner('owner@obolo.test', 'The Owner')");

  const wh = await one("select id from core.locations where code = 'WH'");
  const shop = await one("select id from core.locations where code = 'SHOP'");
  const transit = await one("select id from core.locations where code = 'TRANSIT'");

  await db.query(
    `insert into core.app_users (id, full_name, email, role)
     values ($1, 'Warehouse Staff', 'wh@obolo.test', 'warehouse_staff')`,
    [staff.id],
  );
  await db.query("insert into core.user_locations (user_id, location_id) values ($1, $2)", [
    staff.id,
    wh.id,
  ]);

  const product = await one(
    `insert into core.products (sku, name, base_unit, reorder_point)
     values ('RICE-50', 'Rice 50kg bag', 'bag', 10) returning id`,
  );

  const supplier = await one(
    "insert into core.suppliers (code, name) values ('SUP-1', 'Accra Imports') returning id",
  );

  // --- receipts: two batches at different costs ---------------------------
  const receive = async (qty, cost, freight = 0) => {
    const r = await one(
      `insert into core.receipts (supplier_id, location_id, freight_total, received_by)
       values ($1, $2, $3, $4) returning id`,
      [supplier.id, wh.id, freight, owner.id],
    );
    await db.query(
      `insert into core.receipt_lines (receipt_id, product_id, qty_received, invoice_unit_cost)
       values ($1, $2, $3, $4)`,
      [r.id, product.id, qty, cost],
    );
    await db.query("select public.post_receipt($1)", [r.id]);
    return r.id;
  };

  await receive(100, 10);
  await receive(100, 12);

  let level = await one(
    "select qty_on_hand, total_cost_value from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, wh.id],
  );
  check("warehouse holds 200 units after two receipts", level.qty_on_hand, "200.000");
  check("warehouse value is 100x10 + 100x12 = 2200", level.total_cost_value, "2200.000000");

  // --- FIFO draws oldest first -------------------------------------------
  const transfer = await one(
    `insert into core.transfers (from_location_id, to_location_id, created_by)
     values ($1, $2, $3) returning id`,
    [wh.id, shop.id, owner.id],
  );
  const line = await one(
    `insert into core.transfer_lines (transfer_id, product_id, qty_requested, qty_dispatched)
     values ($1, $2, 150, 150) returning id`,
    [transfer.id, product.id],
  );
  await db.query("select public.post_transfer_dispatch($1)", [transfer.id]);

  level = await one(
    "select qty_on_hand, total_cost_value from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, wh.id],
  );
  // 150 drawn oldest-first = 100@10 + 50@12 = 1600, leaving 50@12 = 600.
  check("warehouse left with 50 units after dispatching 150", level.qty_on_hand, "50.000");
  check("remaining warehouse value is 50x12 = 600 (FIFO, not average)", level.total_cost_value, "600.000000");

  const inTransit = await one(
    "select qty_on_hand, total_cost_value from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, transit.id],
  );
  check("in-transit holds the 150 dispatched units", inTransit.qty_on_hand, "150.000");
  check("in-transit carries their real cost of 1600", inTransit.total_cost_value, "1600.000000");

  const transitBatches = await one(
    "select count(*)::int as n from core.stock_batches where location_id = $1 and qty_remaining > 0",
    [transit.id],
  );
  check("one transit batch per source batch drawn, not an average", transitBatches.n, 2);

  // --- transfers are value-neutral ---------------------------------------
  const net = await one(
    `select coalesce(sum(value_delta), 0) as net from core.stock_movements
      where type in ('transfer_in', 'transfer_out')`,
  );
  check("transfer created no value and destroyed none", net.net, "0.000000");

  // --- short receipt leaves a visible residual ---------------------------
  await db.query("select public.post_transfer_receive($1, $2::jsonb)", [
    transfer.id,
    JSON.stringify([{ line_id: line.id, qty: 140 }]),
  ]);

  const residual = await one(
    "select qty_on_hand, total_cost_value from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, transit.id],
  );
  check("10 unreceived units stay parked in transit", residual.qty_on_hand, "10.000");
  check("and their value stays visible as a discrepancy", residual.total_cost_value, "120.000000");

  const shopLevel = await one(
    "select qty_on_hand, total_cost_value from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, shop.id],
  );
  check("shop received 140 units", shopLevel.qty_on_hand, "140.000");
  // 140 received from transit FIFO: 100@10 + 40@12 = 1480
  check("shop value is 100x10 + 40x12 = 1480", shopLevel.total_cost_value, "1480.000000");

  // --- overselling is refused --------------------------------------------
  let oversold = "no error";
  try {
    await db.query("select public.post_movement('retail_sale', $1, $2, 9999)", [product.id, shop.id]);
  } catch (error) {
    oversold = error.message.includes("insufficient stock") ? "refused" : error.message;
  }
  check("selling more than exists is refused, not booked at zero cost", oversold, "refused");

  // --- landed cost --------------------------------------------------------
  await receive(50, 20, 100); // 50 bags @ 20, plus 100 freight => landed 22
  const landedBatch = await one(
    `select unit_cost from core.stock_batches
      where product_id = $1 and location_id = $2 order by created_at desc limit 1`,
    [product.id, wh.id],
  );
  check("freight lands in the batch cost (20 + 100/50 = 22)", landedBatch.unit_cost, "22.000000");

  // --- append-only ---------------------------------------------------------
  let mutated = "no error";
  try {
    await db.query("update core.stock_movements set qty_delta = 1 where true");
  } catch (error) {
    mutated = error.message.includes("append-only") ? "refused" : error.message;
  }
  check("the ledger refuses to be updated", mutated, "refused");

  let deleted = "no error";
  try {
    await db.query("delete from core.stock_movements where true");
  } catch (error) {
    deleted = error.message.includes("append-only") ? "refused" : error.message;
  }
  check("the ledger refuses to be deleted from", deleted, "refused");

  // --- reversal returns units to their original batch ---------------------
  const damageMv = await one(
    `select public.post_movement('damage', $1, $2, 5, 'water damage') as id`,
    [product.id, shop.id],
  );
  const afterDamage = await one(
    "select qty_on_hand, total_cost_value from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, shop.id],
  );
  check("damage removes 5 units at their own cost", afterDamage.qty_on_hand, "135.000");

  await db.query("select public.reverse_movement($1, 'logged against the wrong product')", [
    damageMv.id,
  ]);
  const afterReversal = await one(
    "select qty_on_hand, total_cost_value from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, shop.id],
  );
  check("reversing restores the quantity exactly", afterReversal.qty_on_hand, shopLevel.qty_on_hand);
  check(
    "reversing restores the value exactly, at the original cost",
    afterReversal.total_cost_value,
    shopLevel.total_cost_value,
  );

  let doubleReversed = "no error";
  try {
    await db.query("select public.reverse_movement($1, 'again')", [damageMv.id]);
  } catch (error) {
    doubleReversed = error.message.includes("already been reversed") ? "refused" : error.message;
  }
  check("a movement cannot be reversed twice", doubleReversed, "refused");

  // --- the three-way integrity check --------------------------------------
  const integrity = await one("select count(*)::int as n from core.check_stock_integrity()");
  check("all three derivations of stock agree", integrity.n, 0);

  // --- point-in-time valuation equals the ledger --------------------------
  const valuation = await one(
    `select coalesce(sum(value), 0) as total from core.valuation_at(now()) where location_id = $1`,
    [wh.id],
  );
  const levelNow = await one(
    "select coalesce(sum(total_cost_value), 0) as total from core.stock_levels where location_id = $1",
    [wh.id],
  );
  check("valuation_at(now) matches the live position", valuation.total, levelNow.total);

  // --- cost masking --------------------------------------------------------
  await asUser(staff.id);
  const staffRole = await one("select public.current_user_role() as role");
  check("staff resolve to warehouse_staff", staffRole.role, "warehouse_staff");

  const staffView = await one(
    "select qty_on_hand, total_cost_value from public.v_stock_levels where location_id = $1 limit 1",
    [wh.id],
  );
  check("staff still see quantity", staffView.qty_on_hand, "100.000");
  check("staff see null for value, not zero", staffView.total_cost_value, "null");

  const staffBatch = await one("select unit_cost from public.v_stock_batches limit 1");
  check("staff see null for batch cost", staffBatch.unit_cost, "null");

  const staffProduct = await one("select last_cost from public.v_products limit 1");
  check("staff see null for product cost", staffProduct.last_cost, "null");

  // Retail stock is another floor: warehouse staff have no assignment there.
  const staffShop = await one(
    "select count(*)::int as n from public.v_stock_levels where location_id = $1",
    [shop.id],
  );
  check("warehouse staff cannot see shop stock at all", staffShop.n, 0);

  let staffCount = "no error";
  try {
    await db.query("select public.post_movement('count_decrease', $1, $2, 1, 'shrinkage')", [
      product.id,
      wh.id,
    ]);
  } catch (error) {
    staffCount = error.message.includes("may not post") ? "refused" : error.message;
  }
  check("staff cannot post a count variance", staffCount, "refused");

  let staffReverse = "no error";
  try {
    await db.query("select public.reverse_movement($1, 'undo')", [damageMv.id]);
  } catch (error) {
    staffReverse = error.message.includes("only an owner") ? "refused" : error.message;
  }
  check("staff cannot reverse a movement", staffReverse, "refused");

  await asUser(owner.id);
  const ownerView = await one(
    "select total_cost_value from public.v_stock_levels where location_id = $1 limit 1",
    [wh.id],
  );
  // 50 left from the second receipt at 12, plus 50 landed at 22.
  check("the owner does see value", ownerView.total_cost_value, "1700.000000");

  // --- idempotency ---------------------------------------------------------
  const token = "11111111-1111-1111-1111-111111111111";
  const first = await one(
    `select public.post_movement('damage', $1, $2, 1, 'spoiled', $3::uuid) as id`,
    [product.id, wh.id, token],
  );
  const replay = await one(
    `select public.post_movement('damage', $1, $2, 1, 'spoiled', $3::uuid) as id`,
    [product.id, wh.id, token],
  );
  check("a replayed request returns the original movement", replay.id, first.id);
  const damageCount = await one(
    "select count(*)::int as n from core.stock_movements where client_token = $1",
    [token],
  );
  check("and posts exactly once", damageCount.n, 1);

  // --- closed periods ------------------------------------------------------
  await db.query(
    "update core.accounting_periods set closed_at = now(), closed_by = $1 where closed_at is null",
    [owner.id],
  );
  let closedPost = "no error";
  try {
    await db.query("select public.post_movement('damage', $1, $2, 1, 'late entry')", [
      product.id,
      wh.id,
    ]);
  } catch (error) {
    closedPost = error.message.includes("was closed") ? "refused" : error.message;
  }
  check("nothing may post into a closed period", closedPost, "refused");
}

main().catch((error) => {
  console.error("\n" + error.message);
  process.exit(1);
});
