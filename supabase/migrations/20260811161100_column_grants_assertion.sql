-- 18 · The masking invariant, asserted at push time
--
-- OBOLO's cost protection is structural: `core` is not a schema PostgREST
-- serves, and no client role holds any privilege inside it. That is stronger
-- than per-column revokes, but only for as long as it stays true. A single
-- `grant select on core.stock_batches to authenticated` in some future
-- migration would undo it silently, and nothing about the app would look
-- different until someone read a cost price they should not have.
--
-- The app OBOLO replaces failed in exactly this shape: it revoked SELECT on one
-- cost column while a blanket table-level grant already covered every column,
-- so the revoke was a no-op that looked like a fix and shipped as one.
--
-- So the invariant is asserted rather than assumed. This migration fails the
-- push if it is ever violated. Re-runnable and cheap, so it can also be run in
-- CI against any database.

do $$
declare
  v_offenders text;
begin
  select string_agg(distinct format('%I.%I -> %s (%s)',
                                    table_schema, table_name, grantee, privilege_type),
                    ', ' order by format('%I.%I -> %s (%s)',
                                    table_schema, table_name, grantee, privilege_type))
    into v_offenders
    from information_schema.role_table_grants
   where table_schema = 'core'
     and grantee in ('anon', 'authenticated', 'PUBLIC');

  if v_offenders is not null then
    raise exception
      'core tables must not be granted to client roles, found: %', v_offenders
      using hint = 'Read through a public.v_* view or write through a public RPC instead.';
  end if;
end $$;

-- The schema itself must also stay unreachable: without USAGE, a grant on an
-- individual table would still be unusable, and this is the cheaper thing to
-- keep true.
do $$
declare
  v_has_usage boolean;
begin
  select bool_or(has_schema_privilege(r, 'core', 'USAGE'))
    into v_has_usage
    from unnest(array['anon', 'authenticated']) r;

  if coalesce(v_has_usage, false) then
    raise exception 'anon or authenticated has USAGE on schema core'
      using hint = 'revoke usage on schema core from anon, authenticated;';
  end if;
end $$;

-- Enum types live in `public` precisely so that RPC signatures and view columns
-- using them can be served. Confirm they are usable, or every masked view
-- fails at runtime with a confusing permission error.
grant usage on schema public to anon, authenticated;
