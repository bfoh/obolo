-- 06 · Accounting periods
--
-- This is what makes past valuations reconstructable rather than merely
-- computable. Without it, someone backdates a receipt into March and last
-- quarter's warehouse value silently changes -- the report you printed and the
-- report you can print today disagree, and nothing records why.
--
-- A movement must post into an open period. The owner closes each month once
-- it is reconciled. After that, corrections post into the current period as an
-- explicit reversal plus a replacement, carrying a reason. That is both
-- auditable and what an accountant expects.
--
-- It also resolves the tension between FIFO and backdating: FIFO consumes in
-- origin-receipt order, but a backdated issue cannot truly be inserted into the
-- past, because the batches it should have drawn from may already be depleted.
-- Confining backdating to the open period keeps that from being a silent
-- rewrite of history.

create table if not exists core.accounting_periods (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  closed_at  timestamptz,
  closed_by  uuid references core.app_users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint period_bounds_ordered check (ends_at > starts_at),
  constraint period_closed_consistently check ((closed_at is null) = (closed_by is null)),

  -- Periods may never overlap, or a movement could belong to two of them and
  -- "is this period closed" would stop having one answer.
  constraint periods_no_overlap
    exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&)
);

create index if not exists idx_periods_open on core.accounting_periods (starts_at)
  where closed_at is null;

-- ---------------------------------------------------------------------------
-- Resolve the period a movement belongs to, refusing anything unpostable.
--
-- Called by post_movement() (migration 19) before any stock is touched, so a
-- rejected posting never leaves a partial ledger behind.
-- ---------------------------------------------------------------------------
create or replace function core.period_for(p_at timestamptz)
returns uuid
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_id     uuid;
  v_closed timestamptz;
begin
  select id, closed_at
    into v_id, v_closed
    from core.accounting_periods
   where tstzrange(starts_at, ends_at, '[)') @> p_at;

  if v_id is null then
    raise exception 'no accounting period covers %', p_at
      using errcode = 'no_data_found',
            hint = 'Open a period covering this date before posting.';
  end if;

  if v_closed is not null then
    raise exception 'accounting period covering % was closed on %', p_at, v_closed
      using errcode = 'object_not_in_prerequisite_state',
            hint = 'Post a correction in the current open period instead.';
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Create the calendar month containing p_at if it does not already exist.
-- Idempotent, so the monthly rollover job can run more than once safely.
--
-- Ghana is UTC+0 all year with no DST, so UTC month boundaries are the real
-- business month boundaries -- no timezone conversion is needed or wanted.
-- ---------------------------------------------------------------------------
create or replace function core.ensure_period(p_at timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_start timestamptz := date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC';
  v_end   timestamptz := (date_trunc('month', p_at at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  v_id    uuid;
begin
  select id into v_id
    from core.accounting_periods
   where starts_at = v_start and ends_at = v_end;

  if v_id is not null then
    return v_id;
  end if;

  insert into core.accounting_periods (name, starts_at, ends_at)
  values (to_char(v_start at time zone 'UTC', 'Mon YYYY'), v_start, v_end)
  returning id into v_id;

  return v_id;
exception
  -- Lost a race with a concurrent rollover; the other transaction's row stands.
  when exclusion_violation then
    select id into v_id
      from core.accounting_periods
     where tstzrange(starts_at, ends_at, '[)') @> p_at;
    return v_id;
end $$;

alter table core.accounting_periods enable row level security;

drop policy if exists periods_read on core.accounting_periods;
create policy periods_read on core.accounting_periods
  for select using (auth.uid() is not null);

-- Seed the current month so the very first receipt has somewhere to post.
select core.ensure_period(now());

comment on table core.accounting_periods is
  'Movements post only into an open period. Closing a period freezes its valuation.';
