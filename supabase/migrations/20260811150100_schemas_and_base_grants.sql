-- 02 · The `core` schema and its lockdown
--
-- This is the structural decision the rest of OBOLO's security rests on.
--
-- Every base table lives in `core`. PostgREST is configured (by default) to
-- serve only `public` and `graphql_public`, so no client -- authenticated or
-- anonymous, through the REST API or the JS SDK -- can reach a base table at
-- all. Cost columns are therefore not protected by remembering to revoke them
-- one by one; they are unreachable because the schema they live in is not
-- served.
--
-- The app reads through security-definer views in `public` (which mask cost via
-- is_owner()) and writes through SECURITY DEFINER RPCs in `public`. There is no
-- third path.
--
-- This exists because the app OBOLO replaces shipped a cost leak: it revoked
-- SELECT on a single column while a blanket table-level GRANT already covered
-- every column, so the revoke silently did nothing and staff could read cost
-- prices with a raw `select=*`. Migration 23 re-asserts this invariant at push
-- time so the same class of bug cannot return unnoticed.

create schema if not exists core;

-- Nothing may reach into `core` -- not PUBLIC, not the Supabase client roles.
revoke all on schema core from public;
revoke all on schema core from anon, authenticated;

-- `postgres` owns and manages the schema; `service_role` needs it for the
-- server-side jobs (snapshots, integrity checks, AI insight generation) that
-- run outside a user session.
grant usage on schema core to postgres, service_role;

-- Future objects in `core` must never be auto-granted to the client roles.
-- Without this, a later `create table core.x` could inherit a default grant and
-- quietly become readable the moment anything grants schema usage.
alter default privileges in schema core revoke all on tables from anon, authenticated;
alter default privileges in schema core revoke all on sequences from anon, authenticated;
alter default privileges in schema core revoke all on functions from anon, authenticated;

-- Shared trigger for `updated_at` maintenance, used by several core tables.
create or replace function core.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

comment on schema core is
  'Private base tables. Never exposed via PostgREST. Read through public.v_* views, write through public RPCs.';
