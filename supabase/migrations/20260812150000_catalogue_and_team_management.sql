-- 24 · Managing the catalogue, suppliers, settings and the team
--
-- Until now a product could only be created, never corrected, and there was no
-- way at all to add a staff member -- which made the role system real in the
-- database and unreachable from the app.
--
-- Editing a product's PRICE is safe and is what this allows. Editing its cost
-- is not offered anywhere: cost lives on the batch, was set by the delivery
-- that brought the goods in, and changing it after the fact would rewrite a
-- valuation the ledger has already recorded. `last_cost` and `avg_cost` on the
-- product are derived by post_receipt, never typed in.

create or replace function public.update_product(
  p_product_id      uuid,
  p_name            text default null,
  p_wholesale_price numeric default null,
  p_retail_price    numeric default null,
  p_reorder_point   numeric default null,
  p_reorder_qty     numeric default null,
  p_base_unit       text default null,
  p_track_expiry    boolean default null,
  p_is_active       boolean default null
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();

  if not exists (select 1 from core.products where id = p_product_id) then
    raise exception 'product not found' using errcode = 'no_data_found';
  end if;

  -- coalesce means "leave alone", so a caller can send one field without
  -- having to resend the whole row and risk clobbering a concurrent edit.
  update core.products
     set name            = coalesce(nullif(btrim(p_name), ''), name),
         wholesale_price = coalesce(p_wholesale_price, wholesale_price),
         retail_price    = coalesce(p_retail_price, retail_price),
         reorder_point   = coalesce(p_reorder_point, reorder_point),
         reorder_qty     = coalesce(p_reorder_qty, reorder_qty),
         base_unit       = coalesce(nullif(btrim(p_base_unit), ''), base_unit),
         track_expiry    = coalesce(p_track_expiry, track_expiry),
         is_active       = coalesce(p_is_active, is_active)
   where id = p_product_id;
end $$;

-- Deactivation rather than deletion. A product that has ever moved is
-- referenced by the ledger, and deleting it would strand that history.
create or replace function public.set_product_active(p_product_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_qty numeric;
begin
  perform core.require_owner();

  if not p_active then
    select coalesce(sum(qty_on_hand), 0) into v_qty
      from core.stock_levels where product_id = p_product_id;

    if v_qty > 0 then
      raise exception 'this product still has % units in stock', v_qty
        using errcode = 'object_not_in_prerequisite_state',
              hint = 'Move or write off the remaining stock before retiring it.';
    end if;
  end if;

  update core.products set is_active = p_active where id = p_product_id;
end $$;

create or replace function public.update_supplier(
  p_supplier_id uuid,
  p_name        text default null,
  p_phone       text default null,
  p_email       text default null,
  p_address     text default null,
  p_is_active   boolean default null
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if public.current_user_role() not in ('owner', 'warehouse_staff') then
    raise exception 'your role may not manage suppliers'
      using errcode = 'insufficient_privilege';
  end if;

  update core.suppliers
     set name      = coalesce(nullif(btrim(p_name), ''), name),
         phone     = coalesce(p_phone, phone),
         email     = coalesce(p_email, email),
         address   = coalesce(p_address, address),
         is_active = coalesce(p_is_active, is_active)
   where id = p_supplier_id;
end $$;

-- ---------------------------------------------------------------------------
-- Company settings
-- ---------------------------------------------------------------------------
create or replace function public.app_settings()
returns table (
  company_name        text,
  tin                 text,
  address             text,
  phone               text,
  currency            char(3),
  expiry_alert_days   int,
  ai_daily_budget_usd text
)
language sql
stable
security definer
set search_path = core, public
as $$
  select s.company_name,
         s.tin,
         s.address,
         s.phone,
         s.currency,
         s.expiry_alert_days,
         -- Budget is money, so it crosses as text like every other amount.
         case when public.is_owner() then s.ai_daily_budget_usd::text end
    from core.app_settings s
   where s.id = 1
     and auth.uid() is not null
$$;

create or replace function public.update_app_settings(
  p_company_name      text default null,
  p_tin               text default null,
  p_address           text default null,
  p_phone             text default null,
  p_expiry_alert_days int default null,
  p_ai_daily_budget   numeric default null
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();

  update core.app_settings
     set company_name      = coalesce(nullif(btrim(p_company_name), ''), company_name),
         tin               = coalesce(p_tin, tin),
         address           = coalesce(p_address, address),
         phone             = coalesce(p_phone, phone),
         expiry_alert_days = coalesce(p_expiry_alert_days, expiry_alert_days),
         ai_daily_budget_usd = coalesce(p_ai_daily_budget, ai_daily_budget_usd)
   where id = 1;
end $$;

-- ---------------------------------------------------------------------------
-- The team
--
-- The auth account is created by the application using the service role, since
-- only it can reach the Auth admin API. This function then gives that account a
-- role and its locations. Both halves check that the caller is an owner, so
-- neither is usable alone as a way in.
-- ---------------------------------------------------------------------------
create or replace function public.add_team_member(
  p_user_id      uuid,
  p_full_name    text,
  p_email        text,
  p_role         public.user_role,
  p_location_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'no account exists for that user'
      using errcode = 'no_data_found';
  end if;

  insert into core.app_users (id, full_name, email, role)
  values (p_user_id, btrim(p_full_name), lower(btrim(p_email)), p_role)
  on conflict (id) do update
     set full_name = excluded.full_name,
         role      = excluded.role,
         status    = 'active';

  delete from core.user_locations where user_id = p_user_id;

  insert into core.user_locations (user_id, location_id)
  select p_user_id, unnest(p_location_ids)
  on conflict do nothing;

  return p_user_id;
end $$;

create or replace function public.update_team_member(
  p_user_id      uuid,
  p_role         public.user_role default null,
  p_status       text default null,
  p_location_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();

  -- The last-owner trigger on core.app_users is what actually prevents an
  -- owner from locking everyone out; this just reaches it with a clearer path.
  update core.app_users
     set role   = coalesce(p_role, role),
         status = coalesce(nullif(btrim(p_status), ''), status)
   where id = p_user_id;

  if p_location_ids is not null then
    delete from core.user_locations where user_id = p_user_id;
    insert into core.user_locations (user_id, location_id)
    select p_user_id, unnest(p_location_ids)
    on conflict do nothing;
  end if;
end $$;

create or replace function public.team()
returns table (
  id           uuid,
  full_name    text,
  email        text,
  role         public.user_role,
  status       text,
  location_ids uuid[],
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();

  return query
    select u.id, u.full_name, u.email, u.role, u.status,
           coalesce(
             array_agg(ul.location_id) filter (where ul.location_id is not null),
             '{}'::uuid[]
           ),
           u.created_at
      from core.app_users u
      left join core.user_locations ul on ul.user_id = u.id
     group by u.id, u.full_name, u.email, u.role, u.status, u.created_at
     order by u.role, u.full_name;
end $$;

-- ---------------------------------------------------------------------------
revoke all on function public.update_product(uuid, text, numeric, numeric, numeric, numeric, text, boolean, boolean) from public;
revoke all on function public.set_product_active(uuid, boolean) from public;
revoke all on function public.update_supplier(uuid, text, text, text, text, boolean) from public;
revoke all on function public.app_settings() from public;
revoke all on function public.update_app_settings(text, text, text, text, int, numeric) from public;
revoke all on function public.add_team_member(uuid, text, text, public.user_role, uuid[]) from public;
revoke all on function public.update_team_member(uuid, public.user_role, text, uuid[]) from public;
revoke all on function public.team() from public;

grant execute on function public.update_product(uuid, text, numeric, numeric, numeric, numeric, text, boolean, boolean) to authenticated;
grant execute on function public.set_product_active(uuid, boolean) to authenticated;
grant execute on function public.update_supplier(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.app_settings() to authenticated;
grant execute on function public.update_app_settings(text, text, text, text, int, numeric) to authenticated;
grant execute on function public.add_team_member(uuid, text, text, public.user_role, uuid[]) to authenticated;
grant execute on function public.update_team_member(uuid, public.user_role, text, uuid[]) to authenticated;
grant execute on function public.team() to authenticated;
