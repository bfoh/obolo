-- 17 · Integrity checks
--
-- The position cache is maintained by one trigger, which is the right design,
-- but "correct by construction" is a claim and this migration is how the claim
-- gets tested every night.
--
-- Three independent derivations must agree per (product, location). Three
-- rather than two on purpose: with two you learn that something is wrong; with
-- three you usually learn which one.
--
--   A  batch.qty_remaining      == sum of that batch's allocations
--   B  stock_levels.qty_on_hand == sum of batch.qty_remaining
--   C  stock_levels.qty_on_hand == sum of movements.qty_delta
--   D  stock_levels.total_cost_value == sum(qty_remaining * unit_cost)

create table if not exists core.integrity_check_log (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  check_name  text not null,
  product_id  uuid references core.products(id) on delete set null,
  location_id uuid references core.locations(id) on delete set null,
  batch_id    uuid references core.stock_batches(id) on delete set null,
  expected    numeric,
  actual      numeric,
  severity    text not null default 'critical' check (severity in ('warning', 'critical')),
  resolved_at timestamptz,
  resolved_by uuid references core.app_users(id) on delete set null
);

create index if not exists idx_integrity_open on core.integrity_check_log (ran_at)
  where resolved_at is null;

create or replace function core.check_stock_integrity()
returns table (
  check_name  text,
  product_id  uuid,
  location_id uuid,
  batch_id    uuid,
  expected    numeric,
  actual      numeric
)
language sql
stable
security definer
set search_path = core, public
as $$
  -- A: a batch's remaining quantity is exactly the sum of its allocations.
  select 'batch_remaining_vs_allocations'::text,
         b.product_id, b.location_id, b.id,
         coalesce(sum(a.qty_delta), 0), b.qty_remaining
    from core.stock_batches b
    left join core.movement_batch_allocations a on a.batch_id = b.id
   group by b.id, b.product_id, b.location_id, b.qty_remaining
  having coalesce(sum(a.qty_delta), 0) <> b.qty_remaining

  union all

  -- B: the level cache equals the sum of its batches.
  select 'level_qty_vs_batches'::text,
         sl.product_id, sl.location_id, null::uuid,
         coalesce(b.total, 0), sl.qty_on_hand
    from core.stock_levels sl
    left join (
      select product_id, location_id, sum(qty_remaining) as total
        from core.stock_batches group by product_id, location_id
    ) b on b.product_id = sl.product_id and b.location_id = sl.location_id
   where coalesce(b.total, 0) <> sl.qty_on_hand

  union all

  -- C: the level cache equals the raw movement ledger. Independent of B --
  -- this one does not look at batches at all.
  select 'level_qty_vs_movements'::text,
         sl.product_id, sl.location_id, null::uuid,
         coalesce(m.total, 0), sl.qty_on_hand
    from core.stock_levels sl
    left join (
      select product_id, location_id, sum(qty_delta) as total
        from core.stock_movements group by product_id, location_id
    ) m on m.product_id = sl.product_id and m.location_id = sl.location_id
   where coalesce(m.total, 0) <> sl.qty_on_hand

  union all

  -- D: the cached value equals what the remaining batches are worth.
  select 'level_value_vs_batches'::text,
         sl.product_id, sl.location_id, null::uuid,
         coalesce(b.total, 0), sl.total_cost_value
    from core.stock_levels sl
    left join (
      select product_id, location_id, sum(qty_remaining * unit_cost) as total
        from core.stock_batches group by product_id, location_id
    ) b on b.product_id = sl.product_id and b.location_id = sl.location_id
   where coalesce(b.total, 0) <> sl.total_cost_value
$$;

-- Records findings for the owner. Returns how many it found, so a scheduled
-- caller can alert on a non-zero result.
create or replace function core.run_integrity_check()
returns int
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_count int;
begin
  insert into core.integrity_check_log (check_name, product_id, location_id, batch_id, expected, actual)
  select c.check_name, c.product_id, c.location_id, c.batch_id, c.expected, c.actual
    from core.check_stock_integrity() c;

  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.integrity_findings()
returns table (
  check_name  text,
  product_id  uuid,
  location_id uuid,
  batch_id    uuid,
  expected    numeric,
  actual      numeric
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  return query select * from core.check_stock_integrity();
end $$;

revoke all on function public.integrity_findings() from public;
grant execute on function public.integrity_findings() to authenticated;

alter table core.integrity_check_log enable row level security;
