-- 29 · Physical stock counts
--
-- Two controls make a count worth doing, and without them it is theatre.
--
-- FREEZE. `system_qty` is captured when the count starts. If stock keeps moving
-- while people are counting, every variance is contaminated by movements that
-- happened during the count, and nobody can tell a real shortfall from a sale
-- that went through at 3pm. The location is therefore locked for the duration.
--
-- SEPARATION. Whoever counts must not be the one who posts the variance. If
-- they are, a shortfall can be counted away and nothing records that it ever
-- existed. Staff submit; only an owner approves and posts. This is the single
-- strongest control against shrinkage in the whole app.

alter table core.locations
  add column if not exists count_lock_id uuid;

create sequence if not exists core.count_number_seq;

create or replace function core.next_count_no()
returns text language sql volatile set search_path = core, public as $$
  select 'CNT-' || lpad(nextval('core.count_number_seq')::text, 5, '0')
$$;

create table if not exists core.stock_counts (
  id             uuid primary key default gen_random_uuid(),
  count_no       text not null unique default core.next_count_no(),
  location_id    uuid not null references core.locations(id) on delete restrict,
  scope          text not null default 'full' check (scope in ('full', 'partial', 'cycle')),
  status         text not null default 'counting'
                 check (status in ('counting', 'submitted', 'posted', 'cancelled')),
  frozen_at      timestamptz not null default now(),
  started_by     uuid not null references core.app_users(id) on delete restrict,
  submitted_by   uuid references core.app_users(id) on delete set null,
  submitted_at   timestamptz,
  posted_by      uuid references core.app_users(id) on delete set null,
  posted_at      timestamptz,
  -- Cost column: what the variance was worth.
  variance_value numeric(18, 6),
  notes          text,
  created_at     timestamptz not null default now(),

  constraint count_submitted_consistently check ((submitted_at is null) = (submitted_by is null)),
  constraint count_posted_consistently check ((posted_at is null) = (posted_by is null))
);

create index if not exists idx_counts_open on core.stock_counts (location_id)
  where status in ('counting', 'submitted');

-- One open count per location. A second would be counting against a system
-- quantity the first one has already frozen.
create unique index if not exists idx_counts_one_open_per_location
  on core.stock_counts (location_id) where status in ('counting', 'submitted');

create table if not exists core.stock_count_lines (
  id            uuid primary key default gen_random_uuid(),
  count_id      uuid not null references core.stock_counts(id) on delete cascade,
  product_id    uuid not null references core.products(id) on delete restrict,
  -- Frozen when the count started. Never recalculated.
  system_qty    numeric(14, 3) not null,
  counted_qty   numeric(14, 3),
  recount_qty   numeric(14, 3),
  variance_qty  numeric(14, 3)
                generated always as (coalesce(recount_qty, counted_qty, system_qty) - system_qty) stored,
  -- Cost column.
  variance_value numeric(18, 6),
  note          text,
  counted_by    uuid references core.app_users(id) on delete set null,
  counted_at    timestamptz,

  unique (count_id, product_id)
);

create index if not exists idx_count_lines_count on core.stock_count_lines (count_id);
create index if not exists idx_count_lines_variance on core.stock_count_lines (count_id)
  where counted_qty is not null;

-- ---------------------------------------------------------------------------
-- The freeze, enforced on the ledger rather than inside one RPC.
--
-- A trigger catches every writer -- an RPC, a scheduled job, the SQL editor --
-- rather than only the paths that remembered to check.
-- ---------------------------------------------------------------------------
create or replace function core.enforce_count_freeze()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_lock uuid;
  v_no   text;
begin
  select count_lock_id into v_lock from core.locations where id = new.location_id;

  if v_lock is not null and new.type not in ('count_increase', 'count_decrease') then
    select count_no into v_no from core.stock_counts where id = v_lock;
    raise exception 'stock count % is in progress here; nothing may move until it is posted', coalesce(v_no, 'unknown')
      using errcode = 'object_not_in_prerequisite_state',
            hint = 'Post or cancel the count first.';
  end if;

  return new;
end $$;

drop trigger if exists trg_count_freeze on core.stock_movements;
create trigger trg_count_freeze
  before insert on core.stock_movements
  for each row execute function core.enforce_count_freeze();

-- ---------------------------------------------------------------------------
create or replace function public.start_count(
  p_location_id uuid,
  p_scope       text default 'full',
  p_notes       text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  public.user_role := public.current_user_role();
  v_id    uuid;
begin
  if v_role is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- Staff may count their own floor; the owner may count anywhere.
  if not public.is_owner() and not exists (
    select 1 from core.user_locations where user_id = v_actor and location_id = p_location_id
  ) then
    raise exception 'you are not assigned to that location'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from core.stock_counts
     where location_id = p_location_id and status in ('counting', 'submitted')
  ) then
    raise exception 'a count is already open at this location'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  insert into core.stock_counts (location_id, scope, notes, started_by)
  values (p_location_id, p_scope, p_notes, v_actor)
  returning id into v_id;

  -- Snapshot what the system believes, before anyone touches a shelf.
  insert into core.stock_count_lines (count_id, product_id, system_qty)
  select v_id, sl.product_id, sl.qty_on_hand
    from core.stock_levels sl
   where sl.location_id = p_location_id
     and sl.qty_on_hand <> 0;

  update core.locations set count_lock_id = v_id where id = p_location_id;

  return v_id;
end $$;

create or replace function public.set_count_line(
  p_count_id   uuid,
  p_product_id uuid,
  p_counted    numeric,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_count core.stock_counts;
  v_id    uuid;
begin
  select * into v_count from core.stock_counts where id = p_count_id;
  if v_count.id is null then
    raise exception 'count not found' using errcode = 'no_data_found';
  end if;

  if v_count.status <> 'counting' then
    raise exception 'count % is %; it can no longer be edited', v_count.count_no, v_count.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_counted is null or p_counted < 0 then
    raise exception 'a counted quantity cannot be negative'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A product found on the shelf that the system does not know about is
  -- counted from a system quantity of zero -- the whole amount is a gain.
  insert into core.stock_count_lines
    (count_id, product_id, system_qty, counted_qty, note, counted_by, counted_at)
  values
    (p_count_id, p_product_id, 0, p_counted, p_note, auth.uid(), now())
  on conflict (count_id, product_id) do update
     set counted_qty = excluded.counted_qty,
         note        = coalesce(excluded.note, core.stock_count_lines.note),
         counted_by  = excluded.counted_by,
         counted_at  = excluded.counted_at
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.submit_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_count core.stock_counts;
begin
  select * into v_count from core.stock_counts where id = p_count_id;

  if v_count.status is distinct from 'counting' then
    raise exception 'count is %, not open for counting', coalesce(v_count.status, 'missing')
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not exists (
    select 1 from core.stock_count_lines where count_id = p_count_id and counted_qty is not null
  ) then
    raise exception 'nothing has been counted yet'
      using errcode = 'invalid_parameter_value';
  end if;

  update core.stock_counts
     set status = 'submitted', submitted_by = auth.uid(), submitted_at = now()
   where id = p_count_id;
end $$;

-- ---------------------------------------------------------------------------
-- Posting a count turns a discrepancy into an accepted adjustment, which is
-- why it is owner-only.
--
-- A gain has to be priced. It is valued at the weighted average of what is
-- already on that shelf, falling back to the product's last purchase cost.
-- Stock that cannot be priced is refused rather than brought in at zero, which
-- would quietly inflate margin on everything sold from it afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.post_count(p_count_id uuid)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor    uuid := auth.uid();
  v_count    core.stock_counts;
  v_line     record;
  v_group    uuid := gen_random_uuid();
  v_cost     numeric(18, 6);
  v_total    numeric(18, 6) := 0;
  v_movement uuid;
  v_value    numeric(18, 6);
begin
  perform core.require_owner();

  select * into v_count from core.stock_counts where id = p_count_id for update;
  if v_count.id is null then
    raise exception 'count not found' using errcode = 'no_data_found';
  end if;

  if v_count.status <> 'submitted' then
    raise exception 'count % is %; it must be submitted before it can be posted',
      v_count.count_no, v_count.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  for v_line in
    select * from core.stock_count_lines
     where count_id = p_count_id and counted_qty is not null and variance_qty <> 0
     order by product_id
  loop
    if v_line.variance_qty > 0 then
      select case when sum(qty_remaining) > 0
                  then round(sum(qty_remaining * unit_cost) / sum(qty_remaining), 6)
             end
        into v_cost
        from core.stock_batches
       where product_id = v_line.product_id
         and location_id = v_count.location_id
         and qty_remaining > 0;

      if v_cost is null then
        select last_cost into v_cost from core.products where id = v_line.product_id;
      end if;

      if v_cost is null then
        raise exception 'cannot value the extra stock found of product %', v_line.product_id
          using errcode = 'invalid_parameter_value',
                hint = 'Receive this product at a known cost before counting a gain of it.';
      end if;

      v_movement := core.post_movement(
        p_type              => 'count_increase',
        p_product_id        => v_line.product_id,
        p_location_id       => v_count.location_id,
        p_qty               => v_line.variance_qty,
        p_actor             => v_actor,
        p_unit_cost         => v_cost,
        p_movement_group_id => v_group,
        p_reason            => format('Count %s', v_count.count_no)
      );
    else
      v_movement := core.post_movement(
        p_type              => 'count_decrease',
        p_product_id        => v_line.product_id,
        p_location_id       => v_count.location_id,
        p_qty               => abs(v_line.variance_qty),
        p_actor             => v_actor,
        p_movement_group_id => v_group,
        p_reason            => format('Count %s', v_count.count_no)
      );
    end if;

    select value_delta into v_value from core.stock_movements where id = v_movement;

    update core.stock_count_lines set variance_value = v_value where id = v_line.id;
    v_total := v_total + v_value;
  end loop;

  update core.stock_counts
     set status = 'posted', posted_by = v_actor, posted_at = now(), variance_value = v_total
   where id = p_count_id;

  update core.locations set count_lock_id = null where id = v_count.location_id;

  return v_group;
end $$;

create or replace function public.cancel_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_count core.stock_counts;
begin
  select * into v_count from core.stock_counts where id = p_count_id;
  if v_count.id is null then
    raise exception 'count not found' using errcode = 'no_data_found';
  end if;

  if v_count.status = 'posted' then
    raise exception 'a posted count cannot be cancelled'
      using errcode = 'object_not_in_prerequisite_state',
            hint = 'Reverse the adjustment movements instead.';
  end if;

  -- Abandoning a count discards the variances, which is a decision about
  -- whether a discrepancy gets recorded. Owner only.
  perform core.require_owner();

  update core.stock_counts set status = 'cancelled' where id = p_count_id;
  update core.locations set count_lock_id = null where id = v_count.location_id;
end $$;

-- ---------------------------------------------------------------------------
drop view if exists public.v_stock_counts;
create or replace view public.v_stock_counts
  with (security_barrier = true, security_invoker = false) as
select c.id,
       c.count_no,
       c.location_id,
       l.code as location_code,
       l.name as location_name,
       c.scope,
       c.status,
       c.frozen_at,
       c.submitted_at,
       c.posted_at,
       case when public.is_owner() then c.variance_value::text end as variance_value,
       c.notes,
       (select count(*) from core.stock_count_lines cl where cl.count_id = c.id) as line_count,
       (select count(*) from core.stock_count_lines cl
         where cl.count_id = c.id and cl.counted_qty is not null) as counted_count,
       (select count(*) from core.stock_count_lines cl
         where cl.count_id = c.id and cl.counted_qty is not null and cl.variance_qty <> 0) as variance_count,
       s.full_name as started_by_name,
       sb.full_name as submitted_by_name
  from core.stock_counts c
  join core.locations l       on l.id = c.location_id
  left join core.app_users s  on s.id = c.started_by
  left join core.app_users sb on sb.id = c.submitted_by
 where public.can_access_location(c.location_id);

drop view if exists public.v_stock_count_lines;
create or replace view public.v_stock_count_lines
  with (security_barrier = true, security_invoker = false) as
select cl.id,
       cl.count_id,
       cl.product_id,
       p.sku,
       p.name as product_name,
       p.base_unit,
       cl.system_qty,
       cl.counted_qty,
       cl.variance_qty,
       case when public.is_owner() then cl.variance_value::text end as variance_value,
       cl.note,
       cl.counted_at
  from core.stock_count_lines cl
  join core.products p     on p.id = cl.product_id
  join core.stock_counts c on c.id = cl.count_id
 where public.can_access_location(c.location_id);

grant select on public.v_stock_counts, public.v_stock_count_lines to authenticated;

revoke all on function public.start_count(uuid, text, text) from public;
revoke all on function public.set_count_line(uuid, uuid, numeric, text) from public;
revoke all on function public.submit_count(uuid) from public;
revoke all on function public.post_count(uuid) from public;
revoke all on function public.cancel_count(uuid) from public;

grant execute on function public.start_count(uuid, text, text) to authenticated;
grant execute on function public.set_count_line(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.submit_count(uuid) to authenticated;
grant execute on function public.post_count(uuid) to authenticated;
grant execute on function public.cancel_count(uuid) to authenticated;

alter table core.stock_counts enable row level security;
alter table core.stock_count_lines enable row level security;
