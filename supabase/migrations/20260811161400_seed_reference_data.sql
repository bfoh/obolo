-- 21 · Reference data
--
-- Idempotent, and safe to re-run. The three locations are not configuration --
-- the ledger cannot function without them, and in_transit in particular must
-- exist before the first transfer is dispatched.

insert into core.locations (code, name, kind)
values
  ('WH',      'Warehouse',   'warehouse'),
  ('SHOP',    'Retail shop', 'retail'),
  ('TRANSIT', 'In transit',  'in_transit')
on conflict (code) do nothing;

insert into core.product_categories (name)
values
  ('Uncategorised')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Bootstrap the first owner.
--
-- Takes an email rather than a user id because the auth user is created through
-- Supabase Auth first, and matching on email is what the operator actually has
-- to hand. Owner-gated except when there is no owner yet -- otherwise the very
-- first call could never be authorised by anyone.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_owner(p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_user_id uuid;
  v_exists  boolean;
begin
  select exists (select 1 from core.app_users where role = 'owner' and status = 'active')
    into v_exists;

  if v_exists and not public.is_owner() then
    raise exception 'an owner already exists; ask them to add you'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_user_id from auth.users where lower(email) = lower(p_email);
  if v_user_id is null then
    raise exception 'no auth user with email %', p_email
      using errcode = 'no_data_found',
            hint = 'Create the account in Supabase Auth first, then run this.';
  end if;

  insert into core.app_users (id, full_name, email, role)
  values (v_user_id, p_full_name, p_email, 'owner')
  on conflict (id) do update
     set role = 'owner', status = 'active', full_name = excluded.full_name;

  -- Owners reach every location, but the join rows keep can_access_location()
  -- truthful for anything that checks assignment directly.
  insert into core.user_locations (user_id, location_id)
  select v_user_id, id from core.locations
  on conflict do nothing;

  return v_user_id;
end $$;

revoke all on function public.bootstrap_owner(text, text) from public;
grant execute on function public.bootstrap_owner(text, text) to authenticated;
