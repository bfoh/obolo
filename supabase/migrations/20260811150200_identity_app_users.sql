-- 03 · Identity and role resolution
--
-- Roles are resolved from a table, not from JWT app_metadata. A JWT claim only
-- changes on token refresh, so demoting or suspending a staff member would
-- leave them holding cost visibility for up to an hour. For a control whose
-- entire purpose is hiding cost from staff, that window is unacceptable. A
-- table lookup takes effect on the next statement.
--
-- The cost is one index lookup per policy evaluation on a table with a handful
-- of rows, and STABLE means it is cached within a statement.

create table if not exists core.app_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (length(btrim(full_name)) > 0),
  email       text,
  phone       text,
  role        public.user_role not null,
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists idx_app_users_email on core.app_users (lower(email)) where email is not null;
create unique index if not exists idx_app_users_phone on core.app_users (phone) where phone is not null;
create index if not exists idx_app_users_role on core.app_users (role) where status = 'active';

drop trigger if exists trg_app_users_touch on core.app_users;
create trigger trg_app_users_touch
  before update on core.app_users
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Last-owner protection
--
-- An owner-less database is unrecoverable through the app: only owners can
-- create users, approve counts, close periods or read cost. This is enforced in
-- the database rather than the UI because the UI is not the only writer.
-- ---------------------------------------------------------------------------
create or replace function core.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
declare
  remaining int;
begin
  if tg_op = 'DELETE' then
    -- Only a departing *active owner* can trip the check.
    if old.role <> 'owner' or old.status <> 'active' then
      return old;
    end if;
  else
    if not (old.role = 'owner' and old.status = 'active') then
      return new;
    end if;
    -- Still an active owner afterwards: nothing lost.
    if new.role = 'owner' and new.status = 'active' then
      return new;
    end if;
  end if;

  select count(*) into remaining
    from core.app_users
   where role = 'owner' and status = 'active' and id <> old.id;

  if remaining = 0 then
    raise exception 'cannot demote, suspend or delete the last active owner'
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_app_users_protect_last_owner on core.app_users;
create trigger trg_app_users_protect_last_owner
  before update or delete on core.app_users
  for each row execute function core.protect_last_owner();

-- ---------------------------------------------------------------------------
-- Role resolvers
--
-- Every one of these derives identity from auth.uid() and never from an
-- argument. A SECURITY DEFINER function that takes the caller's identity as a
-- parameter is an IDOR: any authenticated user can pass someone else's id. The
-- app OBOLO replaces shipped exactly that bug. No exceptions in this codebase.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = core, public
as $$
  select role
    from core.app_users
   where id = auth.uid()
     and status = 'active'
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce(public.current_user_role() = 'owner', false)
$$;

-- Functions are granted to PUBLIC by default; narrow them explicitly.
revoke all on function public.current_user_role() from public;
revoke all on function public.is_owner() from public;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_owner() to authenticated, service_role;

-- RLS is a backstop only -- `core` is not served by PostgREST -- but it is
-- enabled everywhere so that anything accidentally exposed later fails closed.
alter table core.app_users enable row level security;

drop policy if exists app_users_self_read on core.app_users;
create policy app_users_self_read on core.app_users
  for select using (id = auth.uid() or public.is_owner());

comment on function public.current_user_role() is
  'Caller''s role from core.app_users. Identity always from auth.uid(), never a parameter.';
