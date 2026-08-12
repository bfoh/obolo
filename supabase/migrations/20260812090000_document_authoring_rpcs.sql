-- 22 · Authoring RPCs
--
-- The posting RPCs commit a finished document. These are how one gets built in
-- the first place. They exist because `core` is not served by PostgREST, so
-- there is no `insert into transfers` from the client -- which is the point,
-- but it does mean every legitimate write needs a door.
--
-- Each one gates on role, refuses to touch a document that is no longer a
-- draft, and validates the shape of what it is given. Editing a dispatched
-- transfer or a posted delivery would rewrite history that the ledger has
-- already priced.
--
-- Cost entry is owner-only throughout. Staff record quantities; prices and
-- landed costs are the owner's. That is the same line the masked views draw,
-- kept consistent on the write side -- there is no point hiding a cost on read
-- if a staff member can set it on write.

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create or replace function public.create_product(
  p_sku             text,
  p_name            text,
  p_base_unit       text default 'piece',
  p_wholesale_price numeric default null,
  p_retail_price    numeric default null,
  p_reorder_point   numeric default null,
  p_reorder_qty     numeric default null,
  p_pack_unit       text default null,
  p_units_per_pack  numeric default null,
  p_track_expiry    boolean default false,
  p_category_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  perform core.require_owner();

  if coalesce(btrim(p_sku), '') = '' or coalesce(btrim(p_name), '') = '' then
    raise exception 'a product needs a SKU and a name'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into core.products (
    sku, name, base_unit, wholesale_price, retail_price, reorder_point, reorder_qty,
    pack_unit, units_per_pack, track_expiry, category_id, created_by
  ) values (
    btrim(p_sku), btrim(p_name), p_base_unit, p_wholesale_price, p_retail_price,
    p_reorder_point, p_reorder_qty, p_pack_unit, p_units_per_pack, p_track_expiry,
    p_category_id, auth.uid()
  )
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.create_supplier(
  p_code  text,
  p_name  text,
  p_phone text default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('owner', 'warehouse_staff') then
    raise exception 'your role may not manage suppliers'
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.suppliers (code, name, phone, email)
  values (btrim(p_code), btrim(p_name), p_phone, p_email)
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------
create or replace function public.create_transfer(
  p_from_location_id uuid,
  p_to_location_id   uuid,
  p_notes            text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  if not core.can_post(auth.uid(), public.current_user_role(), 'transfer_out', p_from_location_id) then
    raise exception 'your role may not move stock out of that location'
      using errcode = 'insufficient_privilege';
  end if;

  if p_from_location_id = p_to_location_id then
    raise exception 'a transfer needs two different locations'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into core.transfers (from_location_id, to_location_id, notes, created_by)
  values (p_from_location_id, p_to_location_id, p_notes, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

-- Sets the quantity for a product on a draft transfer, adding the line if it is
-- not there yet. Upsert rather than insert so the UI can be "set this to 12"
-- instead of having to know whether a line already exists.
create or replace function public.set_transfer_line(
  p_transfer_id uuid,
  p_product_id  uuid,
  p_qty         numeric
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_status text;
  v_from   uuid;
  v_id     uuid;
begin
  select status, from_location_id into v_status, v_from
    from core.transfers where id = p_transfer_id;

  if v_status is null then
    raise exception 'transfer not found' using errcode = 'no_data_found';
  end if;

  if v_status <> 'draft' then
    raise exception 'this transfer has already been %; it can no longer be edited', v_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not core.can_post(auth.uid(), public.current_user_role(), 'transfer_out', v_from) then
    raise exception 'your role may not edit this transfer'
      using errcode = 'insufficient_privilege';
  end if;

  if p_qty is null or p_qty <= 0 then
    delete from core.transfer_lines where transfer_id = p_transfer_id and product_id = p_product_id;
    return null;
  end if;

  -- qty_dispatched tracks qty_requested at draft time; post_transfer_dispatch
  -- reads qty_dispatched, and a picker who sends less edits it before posting.
  insert into core.transfer_lines (transfer_id, product_id, qty_requested, qty_dispatched)
  values (p_transfer_id, p_product_id, p_qty, p_qty)
  on conflict (transfer_id, product_id) do update
     set qty_requested = excluded.qty_requested,
         qty_dispatched = excluded.qty_dispatched
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.cancel_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_status text;
  v_from   uuid;
begin
  select status, from_location_id into v_status, v_from
    from core.transfers where id = p_transfer_id;

  if v_status is null then
    raise exception 'transfer not found' using errcode = 'no_data_found';
  end if;

  -- Once stock has left the warehouse, cancelling is not a thing that can
  -- happen -- the goods are somewhere. Reverse the dispatch instead.
  if v_status <> 'draft' then
    raise exception 'only a draft transfer can be cancelled; this one is %', v_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not core.can_post(auth.uid(), public.current_user_role(), 'transfer_out', v_from) then
    raise exception 'your role may not cancel this transfer'
      using errcode = 'insufficient_privilege';
  end if;

  update core.transfers set status = 'cancelled' where id = p_transfer_id;
end $$;

-- ---------------------------------------------------------------------------
-- Deliveries
--
-- Owner-only: every field here is a cost. Warehouse staff post a delivery the
-- owner has priced (post_receipt allows it), but they never set the prices.
-- ---------------------------------------------------------------------------
create or replace function public.create_receipt(
  p_location_id text default null,
  p_supplier_id uuid default null,
  p_waybill_no  text default null,
  p_freight     numeric default 0,
  p_duty        numeric default 0,
  p_other       numeric default 0,
  p_received_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id       uuid;
  v_location uuid;
begin
  perform core.require_owner();

  v_location := coalesce(
    p_location_id::uuid,
    (select id from core.locations where kind = 'warehouse' and is_active order by code limit 1)
  );

  if v_location is null then
    raise exception 'no warehouse location to receive into' using errcode = 'no_data_found';
  end if;

  insert into core.receipts (
    supplier_id, location_id, waybill_no, freight_total, duty_total, other_total,
    received_at, received_by
  ) values (
    p_supplier_id, v_location, p_waybill_no, coalesce(p_freight, 0), coalesce(p_duty, 0),
    coalesce(p_other, 0), p_received_at, auth.uid()
  )
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.set_receipt_line(
  p_receipt_id        uuid,
  p_product_id        uuid,
  p_qty               numeric,
  p_invoice_unit_cost numeric,
  p_expiry_date       date default null,
  p_lot_code          text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_status text;
  v_id     uuid;
begin
  perform core.require_owner();

  select status into v_status from core.receipts where id = p_receipt_id;
  if v_status is null then
    raise exception 'delivery not found' using errcode = 'no_data_found';
  end if;

  if v_status <> 'draft' then
    raise exception 'this delivery has already been %; it can no longer be edited', v_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_qty is null or p_qty <= 0 then
    delete from core.receipt_lines where receipt_id = p_receipt_id and product_id = p_product_id;
    return null;
  end if;

  if p_invoice_unit_cost is null or p_invoice_unit_cost < 0 then
    raise exception 'every delivery line needs a unit cost'
      using errcode = 'invalid_parameter_value',
            hint = 'Stock brought in unpriced makes the valuation wrong from day one.';
  end if;

  -- No unique constraint on (receipt_id, product_id): the same product can
  -- legitimately arrive twice on one delivery with different lots or expiry
  -- dates. Replace by product only when the caller is editing a single line.
  delete from core.receipt_lines
   where receipt_id = p_receipt_id
     and product_id = p_product_id
     and coalesce(lot_code, '') = coalesce(p_lot_code, '')
     and expiry_date is not distinct from p_expiry_date;

  insert into core.receipt_lines (
    receipt_id, product_id, qty_received, invoice_unit_cost, expiry_date, lot_code
  ) values (
    p_receipt_id, p_product_id, p_qty, p_invoice_unit_cost, p_expiry_date, p_lot_code
  )
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.set_receipt_charges(
  p_receipt_id uuid,
  p_freight    numeric default 0,
  p_duty       numeric default 0,
  p_other      numeric default 0
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_status text;
begin
  perform core.require_owner();

  select status into v_status from core.receipts where id = p_receipt_id;
  if v_status is distinct from 'draft' then
    raise exception 'charges can only be set on a draft delivery'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  update core.receipts
     set freight_total = coalesce(p_freight, 0),
         duty_total    = coalesce(p_duty, 0),
         other_total   = coalesce(p_other, 0)
   where id = p_receipt_id;
end $$;

-- ---------------------------------------------------------------------------
revoke all on function public.create_product(text, text, text, numeric, numeric, numeric, numeric, text, numeric, boolean, uuid) from public;
revoke all on function public.create_supplier(text, text, text, text) from public;
revoke all on function public.create_transfer(uuid, uuid, text) from public;
revoke all on function public.set_transfer_line(uuid, uuid, numeric) from public;
revoke all on function public.cancel_transfer(uuid) from public;
revoke all on function public.create_receipt(text, uuid, text, numeric, numeric, numeric, timestamptz) from public;
revoke all on function public.set_receipt_line(uuid, uuid, numeric, numeric, date, text) from public;
revoke all on function public.set_receipt_charges(uuid, numeric, numeric, numeric) from public;

grant execute on function public.create_product(text, text, text, numeric, numeric, numeric, numeric, text, numeric, boolean, uuid) to authenticated;
grant execute on function public.create_supplier(text, text, text, text) to authenticated;
grant execute on function public.create_transfer(uuid, uuid, text) to authenticated;
grant execute on function public.set_transfer_line(uuid, uuid, numeric) to authenticated;
grant execute on function public.cancel_transfer(uuid) to authenticated;
grant execute on function public.create_receipt(text, uuid, text, numeric, numeric, numeric, timestamptz) to authenticated;
grant execute on function public.set_receipt_line(uuid, uuid, numeric, numeric, date, text) to authenticated;
grant execute on function public.set_receipt_charges(uuid, numeric, numeric, numeric) to authenticated;
