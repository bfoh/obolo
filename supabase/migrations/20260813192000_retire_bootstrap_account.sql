-- 41 · Retiring the bootstrap account
--
-- The project was bootstrapped under eben.foh@gmail.com, which then sat in the
-- team list as a suspended second owner. It is not a person who uses OBOLO, and
-- a dormant owner account is the kind of thing nobody audits until it is used.
-- The live owner is owusuaduseikingsley@gmail.com and stays untouched.
--
-- Data, not schema -- but it belongs here for the same reason
-- 20260811161400_seed_reference_data.sql does: the CLI is the only path to the
-- remote database, and hand-running this in the SQL editor would leave the two
-- out of step. Idempotent and a no-op everywhere the account does not exist,
-- which includes every fresh database and the verification harness.

do $$
declare
  v_id            uuid;
  v_other_owners  int;
begin
  select id into v_id
    from core.app_users
   where lower(email) = 'eben.foh@gmail.com';

  if v_id is null then
    return;  -- already gone, or a database that never had it
  end if;

  -- An owner-less database is unrecoverable through the app. core.app_users
  -- has a trigger that refuses this, but a trigger firing mid-push aborts the
  -- migration; checking first turns that into a clear skip.
  select count(*) into v_other_owners
    from core.app_users
   where role = 'owner' and status = 'active' and id <> v_id;

  if v_other_owners = 0 then
    raise notice 'skipped: % is the only owner left, so removing it would lock the app', v_id;
    return;
  end if;

  delete from core.user_locations where user_id = v_id;

  begin
    delete from core.app_users where id = v_id;
  exception when foreign_key_violation then
    -- Several ledger tables reference app_users ON DELETE RESTRICT on purpose:
    -- a posted movement must always name who posted it. If this account ever
    -- touched the ledger, suspending is the most that can be done without
    -- stranding that history.
    update core.app_users set status = 'suspended' where id = v_id;
    raise notice 'account % has ledger history; suspended rather than deleted', v_id;
    return;
  end;

  -- Removing the app_users row already removes every right the account had --
  -- public.me() returns nothing and getCurrentUser() resolves to null. Dropping
  -- the Auth user as well is what stops it signing in at all.
  begin
    delete from auth.users where id = v_id;
  exception when others then
    raise notice 'auth user % could not be removed here; delete it in the Supabase dashboard', v_id;
  end;
end $$;
