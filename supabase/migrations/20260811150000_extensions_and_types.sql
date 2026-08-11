-- 01 · Extensions and enum types
--
-- Enums live in `public`, not `core`, even though every table that uses them
-- lives in `core`. Enums carry no data, and PostgREST needs USAGE on the type's
-- schema to serialise an RPC return value or a view column that uses it. Hiding
-- the types would buy nothing and would break `public.current_user_role()`.
--
-- pg_cron and pg_net are deliberately NOT created here. They are only needed by
-- the scheduling migration, and requiring them this early would make the entire
-- foundation unpushable on a project where they are not yet enabled.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Idempotent enum creation. `create type` has no IF NOT EXISTS form.
do $$
begin
  create type public.user_role as enum ('owner', 'warehouse_staff', 'retail_staff');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.location_kind as enum ('warehouse', 'retail', 'in_transit');
exception when duplicate_object then null;
end $$;

-- Every way stock can enter or leave a location. Adding an operation to OBOLO
-- should be a new value here, never a new table -- valuation is an aggregate
-- over all of them and must not need rewriting.
do $$
begin
  create type public.movement_type as enum (
    'opening_balance',
    'receipt',
    'transfer_out',
    'transfer_in',
    'wholesale_sale',
    'retail_sale',
    'customer_return',
    'supplier_return',
    'damage',
    'expiry_writeoff',
    'count_increase',
    'count_decrease'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.sale_channel as enum ('wholesale', 'retail');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.pay_method as enum ('cash', 'momo', 'bank', 'cheque');
exception when duplicate_object then null;
end $$;

comment on type public.movement_type is
  'Every way stock enters or leaves a location. Direction is derived by core.movement_direction().';
