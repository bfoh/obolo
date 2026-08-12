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

  // --- the authoring path, using only public RPCs -------------------------
  // Everything above set up its fixtures by writing to core directly. This
  // section uses only what the app can actually reach, which is the thing that
  // has to work.
  console.log("\nAuthoring path (public RPCs only)");

  const newProduct = await one(
    `select public.create_product('OIL-5L', 'Cooking oil 5L', 'jerrycan', 120, 135, 5) as id`,
  );
  check("owner can create a product", typeof newProduct.id, "string");

  const grn = await one(
    `select public.create_receipt(null, $1, 'WB-9001', 60) as id`,
    [supplier.id],
  );
  await db.query(
    `select public.set_receipt_line($1, $2, 30, 100, null, 'LOT-A')`,
    [grn.id, newProduct.id],
  );
  await db.query("select public.post_receipt($1)", [grn.id]);

  const oilLevel = await one(
    `select qty_on_hand, total_cost_value from core.stock_levels
      where product_id = $1 and location_id = $2`,
    [newProduct.id, wh.id],
  );
  check("delivery posted through RPCs lands in stock", oilLevel.qty_on_hand, "30.000");
  // 30 @ 100 invoice + 60 freight spread over 30 units = 102/unit => 3060.
  check("freight is spread across the line", oilLevel.total_cost_value, "3060.000000");

  let editPosted = "no error";
  try {
    await db.query(`select public.set_receipt_line($1, $2, 5, 100)`, [grn.id, newProduct.id]);
  } catch (error) {
    editPosted = error.message.includes("no longer be edited") ? "refused" : error.message;
  }
  check("a posted delivery cannot be edited", editPosted, "refused");

  const trf = await one(`select public.create_transfer($1, $2) as id`, [wh.id, shop.id]);
  await db.query(`select public.set_transfer_line($1, $2, 12)`, [trf.id, newProduct.id]);
  await db.query("select public.post_transfer_dispatch($1)", [trf.id]);

  let editDispatched = "no error";
  try {
    await db.query(`select public.set_transfer_line($1, $2, 20)`, [trf.id, newProduct.id]);
  } catch (error) {
    editDispatched = error.message.includes("no longer be edited") ? "refused" : error.message;
  }
  check("a dispatched transfer cannot be edited", editDispatched, "refused");

  await asUser(staff.id);
  let staffCreatesProduct = "no error";
  try {
    await db.query(`select public.create_product('X-1', 'Sneaky', 'piece', 1, 2)`);
  } catch (error) {
    staffCreatesProduct = error.message.includes("only an owner") ? "refused" : error.message;
  }
  check("staff cannot create a product and set its prices", staffCreatesProduct, "refused");

  let staffReceipt = "no error";
  try {
    await db.query(`select public.create_receipt(null, $1, 'WB-2')`, [supplier.id]);
  } catch (error) {
    staffReceipt = error.message.includes("only an owner") ? "refused" : error.message;
  }
  check("staff cannot open a delivery and price it", staffReceipt, "refused");

  const staffTransfer = await one(`select public.create_transfer($1, $2) as id`, [wh.id, shop.id]);
  check("warehouse staff can start a transfer out of their warehouse", typeof staffTransfer.id, "string");

  let staffWrongWay = "no error";
  try {
    await db.query(`select public.create_transfer($1, $2)`, [shop.id, wh.id]);
  } catch (error) {
    staffWrongWay = error.message.includes("may not move stock") ? "refused" : error.message;
  }
  check("warehouse staff cannot move stock out of the shop", staffWrongWay, "refused");

  await asUser(owner.id);

  // --- sales, credit and payments -----------------------------------------
  console.log("\nSales, credit and payments");

  const customer = await one(
    `select public.create_customer('CUST-1', 'Adom Stores', '0244000000', null, 'wholesale', 20000, 30) as id`,
  );
  check("owner creates a customer with a credit limit", typeof customer.id, "string");

  const balanceOf = async () =>
    (await one("select core.customer_balance($1) as b", [customer.id])).b;

  check("a new customer owes nothing", await balanceOf(), "0");

  // Warehouse holds 99: 49 @ 12 (older, one unit already damaged off the top
  // of that batch by the idempotency check above) and 50 @ 22.
  const sellable = await one(
    `select qty_on_hand from core.stock_levels where product_id = $1 and location_id = $2`,
    [product.id, wh.id],
  );
  check("stock is there to sell", sellable.qty_on_hand, "99.000");

  const sale = await one(
    `select public.create_sale('wholesale', $1, $2, current_date + 30) as id`,
    [wh.id, customer.id],
  );
  await db.query(`select public.set_sale_line($1, $2, 60, 30)`, [sale.id, product.id]);
  await db.query("select public.post_sale($1, 0)", [sale.id]);

  const posted = await one(
    "select total, total_cogs, gross_profit, payment_status, invoice_no from core.sales_orders where id = $1",
    [sale.id],
  );
  check("the invoice totals 60 x 30", posted.total, "1800.00");
  // FIFO: 49 @ 12 = 588, then 11 @ 22 = 242 -> 830.
  check("COGS comes from the batches actually drawn", posted.total_cogs, "830.000000");
  check("margin is price minus real cost", posted.gross_profit, "970.000000");
  check("an unpaid sale is marked unpaid", posted.payment_status, "unpaid");
  check("the sale is invoiced", posted.invoice_no, "INV-00001");

  check("the customer now owes the invoice", await balanceOf(), "1800.00");

  const afterSale = await one(
    "select qty_on_hand from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, wh.id],
  );
  check("selling took the stock out", afterSale.qty_on_hand, "39.000");

  // Credit limit is checked before any stock moves.
  const bigSale = await one(`select public.create_sale('wholesale', $1, $2, current_date + 30) as id`, [
    wh.id,
    customer.id,
  ]);
  await db.query(`select public.set_sale_line($1, $2, 40, 1000)`, [bigSale.id, product.id]);

  let creditRefused = "no error";
  try {
    await db.query("select public.post_sale($1, 0)", [bigSale.id]);
  } catch (error) {
    creditRefused = error.message.includes("credit refused") ? "refused" : error.message;
  }
  check("a sale beyond the credit limit is refused", creditRefused, "refused");

  const stockUntouched = await one(
    "select qty_on_hand from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, wh.id],
  );
  check("and no stock moved on the refused sale", stockUntouched.qty_on_hand, "39.000");

  // Part payment.
  const payment = await one(
    `select public.record_payment($1, 500, 'momo', 'MM-123') as id`,
    [customer.id],
  );
  check("recording a payment reduces the balance", await balanceOf(), "1300.00");

  const partial = await one("select payment_status from core.sales_orders where id = $1", [sale.id]);
  check("the invoice becomes part-paid", partial.payment_status, "partial");

  // Overpay: the excess stays on account rather than being refused.
  await db.query(`select public.record_payment($1, 2000, 'cash')`, [customer.id]);
  check("an overpayment leaves a credit balance", await balanceOf(), "-700.00");

  const settled = await one("select payment_status from core.sales_orders where id = $1", [sale.id]);
  check("and the invoice is settled", settled.payment_status, "paid");

  // Reversal puts everything back.
  await db.query("select public.reverse_payment($1, 'momo reversal from the bank')", [payment.id]);
  check("reversing a payment restores the balance", await balanceOf(), "-200.00");

  let payTwice = "no error";
  try {
    await db.query("select public.reverse_payment($1, 'again')", [payment.id]);
  } catch (error) {
    payTwice = error.message.includes("already been reversed") ? "refused" : error.message;
  }
  check("a payment cannot be reversed twice", payTwice, "refused");

  let mutatePayment = "no error";
  try {
    await db.query("update core.payments set amount = 1 where true");
  } catch (error) {
    mutatePayment = error.message.includes("append-only") ? "refused" : error.message;
  }
  check("payments refuse to be edited", mutatePayment, "refused");

  // A walk-in paying cash owes nothing and should leave no receivable at all.
  const walkIn = await one(`select public.create_sale('retail', $1, null) as id`, [shop.id]);
  await db.query(`select public.set_sale_line($1, $2, 2, 40)`, [walkIn.id, product.id]);
  await db.query(`select public.post_sale($1, 80, 'cash')`, [walkIn.id]);

  const walkInRow = await one("select payment_status, customer_id from core.sales_orders where id = $1", [
    walkIn.id,
  ]);
  check("a paid walk-in sale is marked paid", walkInRow.payment_status, "paid");
  check("and creates no customer record", walkInRow.customer_id, "null");

  const ledgerCount = await one("select count(*)::int as n from core.customer_ledger_entries");
  check("the walk-in wrote nothing to any ledger", ledgerCount.n, 4);

  // A sale left partly unpaid must name who owes it.
  const anon = await one(`select public.create_sale('retail', $1, null) as id`, [shop.id]);
  await db.query(`select public.set_sale_line($1, $2, 1, 40)`, [anon.id, product.id]);
  let anonCredit = "no error";
  try {
    await db.query("select public.post_sale($1, 0)", [anon.id]);
  } catch (error) {
    anonCredit = error.message.includes("needs a named customer") ? "refused" : error.message;
  }
  check("there is no anonymous credit", anonCredit, "refused");

  const integrityAfterSales = await one("select count(*)::int as n from core.check_stock_integrity()");
  check("stock still reconciles after trading", integrityAfterSales.n, 0);

  await asUser(staff.id);
  const staffOrder = await one(
    "select total, total_cogs, gross_profit from public.v_sales_orders where id = $1",
    [sale.id],
  );
  check("staff see the sale total", staffOrder.total, "1800.00");
  check("staff see null for COGS", staffOrder.total_cogs, "null");
  check("staff see null for margin", staffOrder.gross_profit, "null");
  await asUser(owner.id);

  // --- stock counts --------------------------------------------------------
  console.log("\nStock counts");

  const countId = await one(`select public.start_count($1, 'full') as id`, [wh.id]);
  check("owner can open a count", typeof countId.id, "string");

  const frozenLines = await one(
    "select count(*)::int as n from core.stock_count_lines where count_id = $1",
    [countId.id],
  );
  check("the count snapshots what the system believes", frozenLines.n > 0, true);

  // Everything stops moving here. Otherwise a variance cannot be told apart
  // from a sale that happened while people were counting.
  let frozenPost = "no error";
  try {
    await db.query("select public.post_movement('damage', $1, $2, 1, 'test')", [product.id, wh.id]);
  } catch (error) {
    frozenPost = error.message.includes("count") && error.message.includes("in progress")
      ? "refused"
      : error.message;
  }
  check("the location freezes while counting", frozenPost, "refused");

  const systemQty = await one(
    "select system_qty from core.stock_count_lines where count_id = $1 and product_id = $2",
    [countId.id, product.id],
  );
  // Count 3 fewer than the system says.
  const shortBy = Number(systemQty.system_qty) - 3;
  await db.query(`select public.set_count_line($1, $2, $3, 'three bags missing')`, [
    countId.id,
    product.id,
    shortBy,
  ]);

  const variance = await one(
    "select variance_qty from core.stock_count_lines where count_id = $1 and product_id = $2",
    [countId.id, product.id],
  );
  check("the variance is computed, not typed", variance.variance_qty, "-3.000");

  await db.query("select public.submit_count($1)", [countId.id]);

  // The person who counts must not be the person who accepts the loss.
  await asUser(staff.id);
  let staffPosts = "no error";
  try {
    await db.query("select public.post_count($1)", [countId.id]);
  } catch (error) {
    staffPosts = error.message.includes("only an owner") ? "refused" : error.message;
  }
  check("staff cannot post their own count", staffPosts, "refused");
  await asUser(owner.id);

  const before = await one(
    "select qty_on_hand from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, wh.id],
  );
  await db.query("select public.post_count($1)", [countId.id]);
  const after = await one(
    "select qty_on_hand from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, wh.id],
  );
  check(
    "posting the count writes the shortfall off",
    Number(after.qty_on_hand),
    Number(before.qty_on_hand) - 3,
  );

  const unlocked = await one("select count_lock_id from core.locations where id = $1", [wh.id]);
  check("and releases the freeze", unlocked.count_lock_id, "null");

  const countedIntegrity = await one("select count(*)::int as n from core.check_stock_integrity()");
  check("stock still reconciles after a count", countedIntegrity.n, 0);

  // --- returns -------------------------------------------------------------
  console.log("\nReturns and write-offs");

  const shopStock = await one(
    "select qty_on_hand from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, shop.id],
  );

  const ret = await one(`select public.create_return($1, null, $2, 'wrong size') as id`, [
    customer.id,
    shop.id,
  ]);
  await db.query(`select public.set_return_line($1, $2, 2, 'resalable', 50)`, [ret.id, product.id]);
  await db.query(`select public.set_return_line($1, $2, 1, 'damaged', 50)`, [ret.id, product.id]);
  await db.query("select public.post_return($1)", [ret.id]);

  const afterReturn = await one(
    "select qty_on_hand from core.stock_levels where product_id = $1 and location_id = $2",
    [product.id, shop.id],
  );
  // Only the two resalable units come back; the damaged one is not stock.
  check(
    "resalable goods return to stock",
    Number(afterReturn.qty_on_hand),
    Number(shopStock.qty_on_hand) + 2,
  );

  const creditNote = await one("select amount from core.credit_notes order by issued_at desc limit 1");
  check("the customer is credited for all three units", creditNote.amount, "150.00");

  const damagedMovements = await one(
    `select count(*)::int as n from core.stock_movements m
      join core.return_lines rl on rl.id = m.return_line_id
     where rl.condition = 'damaged'`,
  );
  check("damaged goods create no stock movement at all", damagedMovements.n, 0);

  let unexplained = "no error";
  try {
    await db.query("select public.write_off_stock($1, $2, 1, '')", [product.id, shop.id]);
  } catch (error) {
    unexplained = error.message.includes("say what happened") ? "refused" : error.message;
  }
  check("a write-off must say what happened", unexplained, "refused");

  const returnIntegrity = await one("select count(*)::int as n from core.check_stock_integrity()");
  check("stock reconciles after returns", returnIntegrity.n, 0);

  // --- purchase orders and barcodes ---------------------------------------
  console.log("\nPurchase orders and barcodes");

  const po = await one(`select public.create_purchase_order($1) as id`, [supplier.id]);
  await db.query(`select public.set_po_line($1, $2, 100, 15)`, [po.id, product.id]);

  const poRow = await one("select po_no, status, subtotal from core.purchase_orders where id = $1", [
    po.id,
  ]);
  check("the order totals itself", poRow.subtotal, "1500.000000");
  check("and is numbered", poRow.po_no, "PO-00001");

  let receiveDraft = "no error";
  try {
    await db.query("select public.create_receipt_from_po($1)", [po.id]);
  } catch (error) {
    receiveDraft = error.message.includes("send it before") ? "refused" : error.message;
  }
  check("a draft order cannot be received against", receiveDraft, "refused");

  await db.query(`select public.set_po_status($1, 'sent')`, [po.id]);

  // Receiving 60 of 100 leaves the order partly open.
  const grnFromPo = await one(`select public.create_receipt_from_po($1) as id`, [po.id]);
  const prefilled = await one(
    "select qty_received, invoice_unit_cost from core.receipt_lines where receipt_id = $1",
    [grnFromPo.id],
  );
  check("the delivery is pre-filled with what is outstanding", prefilled.qty_received, "100.000");
  check("priced as ordered", prefilled.invoice_unit_cost, "15.000000");

  await db.query("update core.receipt_lines set qty_received = 60 where receipt_id = $1", [
    grnFromPo.id,
  ]);
  await db.query("select public.post_receipt($1)", [grnFromPo.id]);

  const afterPartial = await one(
    `select po.status, l.qty_received
       from core.purchase_orders po
       join core.purchase_order_lines l on l.po_id = po.id
      where po.id = $1`,
    [po.id],
  );
  check("the order tracks what has arrived", afterPartial.qty_received, "60.000");
  check("and knows it is only partly received", afterPartial.status, "partially_received");

  const grn2 = await one(`select public.create_receipt_from_po($1) as id`, [po.id]);
  const remaining = await one(
    "select qty_received from core.receipt_lines where receipt_id = $1",
    [grn2.id],
  );
  check("the next delivery offers only the remainder", remaining.qty_received, "40.000");

  await db.query("select public.post_receipt($1)", [grn2.id]);
  const closed = await one("select status from core.purchase_orders where id = $1", [po.id]);
  check("a fully received order closes itself", closed.status, "received");

  let receiveAgain = "no error";
  try {
    await db.query("select public.create_receipt_from_po($1)", [po.id]);
  } catch (error) {
    receiveAgain = error.message.includes("already been received") ? "refused" : error.message;
  }
  check("and cannot be received against again", receiveAgain, "refused");

  // Barcodes.
  await db.query(`select public.add_product_barcode($1, '5901234123457', 'bag', true)`, [product.id]);
  const scan = await one(`select * from public.lookup_barcode('5901234123457', $1)`, [wh.id]);
  check("scanning a code finds the product", scan.sku, "RICE-50");
  check("and reports what is on that shelf", Number(scan.qty_on_hand) > 0, true);
  check("owner sees the value of it", typeof scan.stock_value, "string");

  const missing = await db.query(`select * from public.lookup_barcode('0000000000000', $1)`, [wh.id]);
  check("an unknown code returns nothing rather than erroring", missing.rows.length, 0);

  await asUser(staff.id);
  const staffScan = await one(`select * from public.lookup_barcode('5901234123457', $1)`, [wh.id]);
  check("staff can scan too", staffScan.sku, "RICE-50");
  check("but see no value", staffScan.stock_value, "null");

  let staffBarcode = "no error";
  try {
    await db.query(`select public.add_product_barcode($1, '999', 'bag')`, [product.id]);
  } catch (error) {
    staffBarcode = error.message.includes("only an owner") ? "refused" : error.message;
  }
  check("staff cannot reassign a barcode", staffBarcode, "refused");

  let staffPo = "no error";
  try {
    await db.query(`select public.create_purchase_order($1)`, [supplier.id]);
  } catch (error) {
    staffPo = error.message.includes("only an owner") ? "refused" : error.message;
  }
  check("staff cannot commit the company to an order", staffPo, "refused");
  await asUser(owner.id);

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
