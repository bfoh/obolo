-- 10 · The stock ledger
--
-- Three layers:
--
--   Event      core.stock_movements              append-only
--   FIFO detail core.movement_batch_allocations  append-only
--   Position   core.stock_batches, core.stock_levels   derived, trigger-written
--
-- One movements table with a type enum rather than a table per operation.
-- Valuation is an aggregate over every type -- "what is the warehouse worth" is
-- sum(value_delta) at that location -- so splitting the ledger would turn the
-- app's most correctness-critical query into an N-way UNION that has to be
-- rewritten every time an operation is added. It would also delete the only
-- cross-check that catches drift: qty must agree across three independent
-- derivations (see the integrity migration), and the third only exists if every
-- movement is in one place.
--
-- Type-specific data stays in the source document tables and links back through
-- typed nullable FKs, not a (ref_table text, ref_id text) pair -- that pattern
-- has no referential integrity, no cascade behaviour, and casts uuids to text.

-- Direction of each movement type. IMMUTABLE because a CHECK constraint may
-- only call immutable functions.
create or replace function core.movement_direction(p_type public.movement_type)
returns int
language sql
immutable
as $$
  select case p_type
    when 'opening_balance'  then  1
    when 'receipt'          then  1
    when 'transfer_in'      then  1
    when 'customer_return'  then  1
    when 'count_increase'   then  1
    when 'transfer_out'     then -1
    when 'wholesale_sale'   then -1
    when 'retail_sale'      then -1
    when 'supplier_return'  then -1
    when 'damage'           then -1
    when 'expiry_writeoff'  then -1
    when 'count_decrease'   then -1
  end
$$;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table if not exists core.stock_movements (
  id                   uuid primary key default gen_random_uuid(),
  -- Strict total order that no backdating can perturb. Reports replay by
  -- occurred_at ("what was true on this date"); audits replay by seq ("what did
  -- we believe, in the order we came to believe it").
  seq                  bigint generated always as identity,

  type                 public.movement_type not null,
  product_id           uuid not null references core.products(id) on delete restrict,
  location_id          uuid not null references core.locations(id) on delete restrict,

  qty_delta            numeric(14, 3) not null check (qty_delta <> 0),
  -- Signed cost impact, stamped from the batches actually drawn. Cost column.
  value_delta          numeric(18, 6) not null,
  -- Selling price, on sale types only. Not a cost, so not masked.
  unit_price           numeric(14, 2),

  -- Ties a document's lines together, and both legs of a transfer.
  movement_group_id    uuid not null default gen_random_uuid(),

  reverses_movement_id uuid unique references core.stock_movements(id) on delete restrict,
  correction_group_id  uuid,
  reason               text,

  -- Exactly one typed source document line. Sales, count and return line
  -- references are added by their own migrations, which also widen this check.
  receipt_line_id      uuid references core.receipt_lines(id) on delete restrict,
  transfer_line_id     uuid references core.transfer_lines(id) on delete restrict,

  occurred_at          timestamptz not null default now(),
  period_id            uuid not null references core.accounting_periods(id) on delete restrict,

  -- Idempotency. A retried POST on a bad connection must not post twice.
  client_token         uuid,

  created_by           uuid not null references core.app_users(id) on delete restrict,
  created_at           timestamptz not null default now(),

  constraint mv_one_source check (num_nonnulls(receipt_line_id, transfer_line_id) <= 1),

  -- Makes an inbound sale or an outbound receipt unrepresentable. A reversal
  -- carries the opposite sign to the type it undoes.
  constraint mv_sign_matches_type check (
    sign(qty_delta) = case
      when reverses_movement_id is null then  core.movement_direction(type)
      else                                   -core.movement_direction(type)
    end
  ),

  -- A correction must say why. An unexplained adjustment is the thing an
  -- auditor asks about first.
  constraint mv_reversal_has_reason check (reverses_movement_id is null or reason is not null)
);

create unique index if not exists idx_mv_client_token
  on core.stock_movements (client_token) where client_token is not null;

-- The valuation path: sum(value_delta) for a location up to a point in time.
create index if not exists idx_mv_valuation
  on core.stock_movements (location_id, occurred_at) include (qty_delta, value_delta);

create index if not exists idx_mv_product on core.stock_movements (product_id, location_id, seq);
create index if not exists idx_mv_group on core.stock_movements (movement_group_id);
create index if not exists idx_mv_type_time on core.stock_movements (type, occurred_at);
create index if not exists idx_mv_period on core.stock_movements (period_id);

-- ---------------------------------------------------------------------------
-- Batches
--
-- A batch belongs to exactly one location. A transfer draws FIFO from the
-- source and creates one new batch per source batch drawn, inheriting its cost
-- and lineage. Averaging them into a single destination batch would destroy
-- per-batch cost and silently corrupt margin at the shop.
--
-- Keeping the batch row *as* the position is what allows qty_remaining >= 0 to
-- be a column CHECK -- the last line of defence against negative stock.
-- ---------------------------------------------------------------------------
create table if not exists core.stock_batches (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references core.products(id) on delete restrict,
  location_id         uuid not null references core.locations(id) on delete restrict,
  parent_batch_id     uuid references core.stock_batches(id) on delete restrict,
  lot_code            text,

  qty_received        numeric(14, 3) not null check (qty_received > 0),
  -- Starts at zero and is brought to qty_received by the batch's own inbound
  -- allocation, so qty_remaining is always exactly the sum of this batch's
  -- allocations -- never a separately maintained number that can disagree.
  qty_remaining       numeric(14, 3) not null default 0 check (qty_remaining >= 0),

  -- Landed cost. Cost column.
  unit_cost           numeric(18, 6) not null check (unit_cost >= 0),

  -- FIFO orders by origin_received_at, not received_at, so the shop sells the
  -- genuinely oldest goods rather than whichever pallet was transferred first.
  origin_received_at  timestamptz not null,
  received_at         timestamptz not null default now(),

  expiry_date         date,
  supplier_id         uuid references core.suppliers(id) on delete set null,
  receipt_line_id     uuid references core.receipt_lines(id) on delete restrict,
  created_movement_id uuid not null references core.stock_movements(id) on delete restrict,
  created_at          timestamptz not null default now(),

  -- Catches a double reversal returning the same units twice, which would
  -- otherwise manufacture stock out of nothing.
  constraint batch_remaining_le_received check (qty_remaining <= qty_received)
);

-- The most important index in the database: both the FIFO allocation path and
-- the per-location valuation path.
create index if not exists idx_batch_fifo
  on core.stock_batches (product_id, location_id, origin_received_at, id)
  where qty_remaining > 0;

create index if not exists idx_batch_expiry
  on core.stock_batches (expiry_date)
  where qty_remaining > 0 and expiry_date is not null;

create index if not exists idx_batch_location
  on core.stock_batches (location_id, product_id) where qty_remaining > 0;

create index if not exists idx_batch_parent on core.stock_batches (parent_batch_id);
create index if not exists idx_batch_movement on core.stock_batches (created_movement_id);

-- Close the loop from a receipt line to the batch it created.
do $$
begin
  alter table core.receipt_lines
    add constraint receipt_lines_batch_fk
    foreign key (batch_id) references core.stock_batches(id) on delete restrict;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- FIFO detail
--
-- One row per batch touched by a movement, for EVERY movement type -- not just
-- sales. This is what lets a transfer, a write-off or a count adjustment record
-- which batch it consumed, and therefore what it cost. It is also what makes a
-- reversal able to return units to the exact batch they came from, at the exact
-- cost they left at, without perturbing FIFO order.
-- ---------------------------------------------------------------------------
create table if not exists core.movement_batch_allocations (
  id          uuid primary key default gen_random_uuid(),
  movement_id uuid not null references core.stock_movements(id) on delete restrict,
  -- RESTRICT, never SET NULL: nulling the batch on delete orphans cost history,
  -- which is how an audit trail rots quietly.
  batch_id    uuid not null references core.stock_batches(id) on delete restrict,

  qty_delta   numeric(14, 3) not null check (qty_delta <> 0),
  unit_cost   numeric(18, 6) not null check (unit_cost >= 0),

  -- Generated, not stored-and-checked. `qty * cost` can carry nine decimals
  -- (3 + 6), so writing it by hand and asserting equality against the same
  -- product would compare a rounded value to an unrounded one and fail on
  -- ordinary data. Generating it makes the rounding happen exactly once, and
  -- removes any way for a caller to supply a value that disagrees with its
  -- own inputs.
  value_delta numeric(18, 6) generated always as (qty_delta * unit_cost) stored,

  created_at  timestamptz not null default now()
);

create index if not exists idx_alloc_batch on core.movement_batch_allocations (batch_id);
create index if not exists idx_alloc_movement on core.movement_batch_allocations (movement_id);

-- ---------------------------------------------------------------------------
-- Position cache
--
-- Written by exactly one trigger (next migration). Never by an RPC, a client,
-- or a migration.
-- ---------------------------------------------------------------------------
create table if not exists core.stock_levels (
  product_id       uuid not null references core.products(id) on delete restrict,
  location_id      uuid not null references core.locations(id) on delete restrict,
  qty_on_hand      numeric(14, 3) not null default 0,
  -- Cost column. Always equals sum(qty_remaining * unit_cost) over the
  -- location's batches, because every allocation contributes qty * cost to both.
  total_cost_value numeric(18, 6) not null default 0,
  updated_at       timestamptz not null default now(),

  primary key (product_id, location_id),
  constraint stock_levels_non_negative check (qty_on_hand >= 0)
);

create index if not exists idx_stock_levels_location
  on core.stock_levels (location_id) where qty_on_hand > 0;

alter table core.stock_movements enable row level security;
alter table core.stock_batches enable row level security;
alter table core.movement_batch_allocations enable row level security;
alter table core.stock_levels enable row level security;

comment on table core.stock_movements is
  'Append-only event log. Valuation at any time T is sum(value_delta) where occurred_at <= T.';
comment on column core.stock_movements.seq is
  'Total order for reproducible replay. Backdating changes occurred_at, never seq.';
