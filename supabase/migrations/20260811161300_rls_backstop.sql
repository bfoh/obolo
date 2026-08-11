-- 20 · RLS backstop
--
-- Row level security is not what protects OBOLO's data -- the private `core`
-- schema is. RLS is the second wall: if some future change ever exposes a core
-- table, it should deny by default rather than serve everything.
--
-- Most core tables carry RLS with no policy at all, which means "no client may
-- read this". That is deliberate and correct here, not an oversight. The few
-- SELECT policies that do exist were added alongside their tables for the
-- reference data every signed-in user legitimately needs.
--
-- Nothing gets an INSERT, UPDATE or DELETE policy anywhere. Every write in this
-- app goes through a SECURITY DEFINER RPC, so a write policy would only create
-- a second path to keep correct.

do $$
declare
  v_table  text;
  v_missing text[] := '{}';
begin
  for v_table in
    select tablename from pg_tables where schemaname = 'core'
  loop
    execute format('alter table core.%I enable row level security', v_table);
  end loop;

  -- Confirm it actually took, rather than trusting the loop above.
  select array_agg(c.relname order by c.relname)
    into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'core'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    raise exception 'RLS is not enabled on core tables: %', array_to_string(v_missing, ', ');
  end if;
end $$;

-- No write policies exist anywhere in `core`. Assert that, so a future
-- migration cannot quietly open a second write path alongside the RPCs.
do $$
declare
  v_offenders text;
begin
  select string_agg(format('%s on %s', policyname, tablename), ', ')
    into v_offenders
    from pg_policies
   where schemaname = 'core'
     and cmd <> 'SELECT';

  if v_offenders is not null then
    raise exception 'core has non-SELECT RLS policies: %', v_offenders
      using hint = 'All writes must go through a SECURITY DEFINER RPC.';
  end if;
end $$;
