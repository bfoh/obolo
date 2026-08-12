-- 16 · Valuation
--
-- Definition, and it is the authoritative one: the value of a location at time
-- T is sum(value_delta) over its movements with occurred_at <= T. This is exact
-- and needs nothing else, because every movement carries its own cost impact,
-- stamped at allocation time from the batch actually drawn. That is the whole
-- reason movement_batch_allocations exists for every movement type and not only
-- for sales.
--
-- On snapshots: the obvious optimisation is to store a nightly position and
-- replay only the movements since. That is WRONG here, and subtly so. A
-- movement backdated into the open period after last night's snapshot has an
-- occurred_at before the snapshot but was written after it, so replaying "only
-- what came later" silently misses it and the reported value drifts from the
-- ledger. Since a wrong valuation is the one failure this app cannot have,
-- valuation_at() always sums the ledger. The index on
-- (location_id, occurred_at) INCLUDE (qty_delta, value_delta) makes that an
-- index-only scan.
--
-- core.stock_snapshots is therefore a REPORTING series -- the daily close, for
-- charting value over time -- and never a correctness input. It is recomputed
-- from the ledger rather than accumulated, so backdating self-heals.

create table if not exists core.stock_snapshots (
  as_of       date not null,
  location_id uuid not null references core.locations(id) on delete cascade,
  product_id  uuid not null references core.products(id) on delete cascade,
  qty         numeric(14, 3) not null,
  value       numeric(18, 6) not null,   -- cost column
  computed_at timestamptz not null default now(),
  primary key (as_of, location_id, product_id)
);

create index if not exists idx_snapshots_as_of on core.stock_snapshots (as_of, location_id);

-- ---------------------------------------------------------------------------
-- Exact position at a point in time.
-- ---------------------------------------------------------------------------
create or replace function core.valuation_at(
  p_at          timestamptz,
  p_location_id uuid default null
)
returns table (
  location_id uuid,
  product_id  uuid,
  qty         numeric,
  value       numeric
)
language sql
stable
security definer
set search_path = core, public
as $$
  select m.location_id,
         m.product_id,
         sum(m.qty_delta)   as qty,
         sum(m.value_delta) as value
    from core.stock_movements m
   where m.occurred_at <= p_at
     and (p_location_id is null or m.location_id = p_location_id)
   group by m.location_id, m.product_id
  having sum(m.qty_delta) <> 0 or sum(m.value_delta) <> 0
$$;

-- Owner-only, because it returns value.
create or replace function public.valuation_at(
  p_at          timestamptz,
  p_location_id uuid default null
)
returns table (
  location_id uuid,
  product_id  uuid,
  qty         numeric,
  value       numeric
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  return query select * from core.valuation_at(p_at, p_location_id);
end $$;

-- ---------------------------------------------------------------------------
-- Totals per location at a point in time. The dashboard's headline figures.
--
-- Dropped before creating, because CREATE OR REPLACE cannot change a
-- function's return type. A later migration widens total_value to text, so
-- replaying the whole sequence over an existing database would otherwise stop
-- here. Replaying in order still ends in the correct state: this recreates the
-- original shape and migration 23 supersedes it again.
-- ---------------------------------------------------------------------------
drop function if exists public.valuation_summary(timestamptz);

create or replace function public.valuation_summary(p_at timestamptz default now())
returns table (
  location_id   uuid,
  location_code text,
  location_name text,
  location_kind public.location_kind,
  qty_on_hand   numeric,
  total_value   numeric,
  product_count bigint
)
language sql
stable
security definer
set search_path = core, public
as $$
  select l.id,
         l.code,
         l.name,
         l.kind,
         coalesce(sum(v.qty), 0),
         -- Masked rather than zeroed: a staff caller must not be shown a
         -- number that reads as "this stock is worthless".
         case when public.is_owner() then coalesce(sum(v.value), 0) end,
         count(v.product_id) filter (where v.qty > 0)
    from core.locations l
    left join core.valuation_at(p_at) v on v.location_id = l.id
   where l.is_active
     and public.can_access_location(l.id)
   group by l.id, l.code, l.name, l.kind
   order by l.kind, l.code
$$;

-- ---------------------------------------------------------------------------
-- The daily close series, recomputed rather than accumulated so that a
-- backdated movement corrects the history instead of corrupting it.
-- ---------------------------------------------------------------------------
create or replace function core.rebuild_snapshots(p_days int default 35)
returns int
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_day   date;
  v_from  date := (now() at time zone 'UTC')::date - p_days;
  v_rows  int := 0;
  v_added int;
begin
  for v_day in select generate_series(v_from, (now() at time zone 'UTC')::date, interval '1 day')::date
  loop
    delete from core.stock_snapshots where as_of = v_day;

    insert into core.stock_snapshots (as_of, location_id, product_id, qty, value)
    select v_day, v.location_id, v.product_id, v.qty, v.value
      from core.valuation_at((v_day + 1)::timestamptz) v;

    get diagnostics v_added = row_count;
    v_rows := v_rows + v_added;
  end loop;

  return v_rows;
end $$;

comment on function core.valuation_at(timestamptz, uuid) is
  'Exact position at a point in time, summed from the ledger. Never accelerated by snapshots -- see the migration header.';
