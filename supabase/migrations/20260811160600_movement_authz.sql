-- 13 · Who may post what, where
--
-- Two layers, on purpose:
--
--   core.can_post()  authorises ONE movement for ONE actor at ONE location.
--                    Used by public.post_movement() for standalone postings
--                    (a damage, an expiry write-off).
--
--   Document RPCs    authorise the DOCUMENT once, then call core.post_movement()
--                    directly for each leg. A transfer dispatch posts an
--                    outbound leg at the warehouse and an inbound leg at
--                    in_transit; asking can_post() to bless a warehouse
--                    staffer posting into in_transit would mean granting them
--                    a capability that only makes sense inside that one
--                    operation. Authorising the operation instead of each of
--                    its mechanical steps keeps the permission honest.

create or replace function core.can_post(
  p_user_id     uuid,
  p_role        public.user_role,
  p_type        public.movement_type,
  p_location_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_kind    public.location_kind;
  v_allowed boolean;
begin
  if p_user_id is null or p_role is null then
    return false;
  end if;

  select kind into v_kind from core.locations where id = p_location_id and is_active;
  if v_kind is null then
    return false;
  end if;

  if p_role = 'owner' then
    return true;
  end if;

  -- Staff may only act at a location they are assigned to.
  if not exists (
    select 1 from core.user_locations
     where user_id = p_user_id and location_id = p_location_id
  ) then
    return false;
  end if;

  -- Posting a count variance turns a discrepancy into an accepted adjustment.
  -- If the person who counts can also post the variance, a shortfall can be
  -- counted away and nobody sees it. Staff submit; only an owner posts.
  if p_type in ('count_increase', 'count_decrease') then
    return false;
  end if;

  -- Opening balances set the ledger's starting position and price it. Owner only.
  if p_type = 'opening_balance' then
    return false;
  end if;

  v_allowed := case p_role
    when 'warehouse_staff' then
      v_kind = 'warehouse'
      and p_type in ('receipt', 'transfer_out', 'wholesale_sale',
                     'supplier_return', 'damage', 'expiry_writeoff')
    when 'retail_staff' then
      v_kind = 'retail'
      and p_type in ('transfer_in', 'retail_sale', 'customer_return',
                     'damage', 'expiry_writeoff')
    else false
  end;

  return coalesce(v_allowed, false);
end $$;

comment on function core.can_post(uuid, public.user_role, public.movement_type, uuid) is
  'Authorises a single standalone movement. Document RPCs authorise the operation instead.';
