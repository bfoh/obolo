-- 31 · Purchase orders, receiving against them, and barcodes
--
-- The PO tables were created back in migration 07 because receipts referenced
-- them, but nothing could author one. This finishes that: raise an order, send
-- it, then receive a delivery against it with the outstanding quantities
-- already filled in.
--
-- Receiving against a PO is where the value is. Typing a delivery from scratch
-- invites transposed quantities and forgotten lines; starting from what was
-- ordered means the only thing anyone has to think about is where reality
-- differs from the order.

create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_location_id uuid default null,
  p_expected_at timestamptz default null,
  p_notes       text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_location uuid;
  v_id       uuid;
begin
  -- A purchase order commits the company's money, so it is the owner's.
  perform core.require_owner();

  v_location := coalesce(
    p_location_id,
    (select id from core.locations where kind = 'warehouse' and is_active order by code limit 1)
  );

  if v_location is null then
    raise exception 'no warehouse to order into' using errcode = 'no_data_found';
  end if;

  insert into core.purchase_orders (supplier_id, location_id, expected_at, notes, created_by, ordered_at)
  values (p_supplier_id, v_location, p_expected_at, p_notes, auth.uid(), now())
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.set_po_line(
  p_po_id      uuid,
  p_product_id uuid,
  p_qty        numeric,
  p_unit_cost  numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_status text;
  v_cost   numeric(18, 6);
  v_id     uuid;
begin
  perform core.require_owner();

  select status into v_status from core.purchase_orders where id = p_po_id;
  if v_status is null then
    raise exception 'purchase order not found' using errcode = 'no_data_found';
  end if;

  -- Once anything has been received the order is a record of what was agreed,
  -- not a working document.
  if v_status not in ('draft', 'sent') then
    raise exception 'this order is %; it can no longer be edited', v_status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_qty is null or p_qty <= 0 then
    delete from core.purchase_order_lines where po_id = p_po_id and product_id = p_product_id;
    perform core.refresh_po_total(p_po_id);
    return null;
  end if;

  -- Default to what this product last cost, so ordering does not require
  -- re-typing a price that has not changed.
  v_cost := coalesce(p_unit_cost, (select last_cost from core.products where id = p_product_id));

  if v_cost is null then
    raise exception 'no cost known for this product; enter what it will cost'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into core.purchase_order_lines (po_id, product_id, qty_ordered, unit_cost)
  values (p_po_id, p_product_id, p_qty, v_cost)
  on conflict (po_id, product_id) do update
     set qty_ordered = excluded.qty_ordered, unit_cost = excluded.unit_cost
  returning id into v_id;

  perform core.refresh_po_total(p_po_id);
  return v_id;
end $$;

create or replace function core.refresh_po_total(p_po_id uuid)
returns void
language sql
security definer
set search_path = core, public
as $$
  update core.purchase_orders po
     set subtotal = coalesce((
           select sum(l.qty_ordered * l.unit_cost)
             from core.purchase_order_lines l where l.po_id = po.id
         ), 0)
   where po.id = p_po_id
$$;

create or replace function public.set_po_status(p_po_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_current text;
begin
  perform core.require_owner();

  select status into v_current from core.purchase_orders where id = p_po_id;
  if v_current is null then
    raise exception 'purchase order not found' using errcode = 'no_data_found';
  end if;

  if p_status not in ('sent', 'cancelled', 'closed') then
    raise exception 'a purchase order cannot be moved to %', p_status
      using errcode = 'invalid_parameter_value';
  end if;

  if p_status = 'cancelled' and v_current in ('partially_received', 'received') then
    raise exception 'goods have already arrived against this order'
      using errcode = 'object_not_in_prerequisite_state',
            hint = 'Close it instead, which leaves the receipts intact.';
  end if;

  update core.purchase_orders
     set status = p_status,
         approved_by = case when p_status = 'sent' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'sent' then now() else approved_at end
   where id = p_po_id;
end $$;

-- ---------------------------------------------------------------------------
-- Start a delivery from an order, pre-filled with what is still outstanding.
-- ---------------------------------------------------------------------------
create or replace function public.create_receipt_from_po(p_po_id uuid)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_po      core.purchase_orders;
  v_receipt uuid;
  v_count   int;
begin
  perform core.require_owner();

  select * into v_po from core.purchase_orders where id = p_po_id;
  if v_po.id is null then
    raise exception 'purchase order not found' using errcode = 'no_data_found';
  end if;

  if v_po.status in ('draft', 'cancelled', 'closed') then
    raise exception 'this order is %; send it before receiving against it', v_po.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  insert into core.receipts (po_id, supplier_id, location_id, received_by)
  values (p_po_id, v_po.supplier_id, v_po.location_id, auth.uid())
  returning id into v_receipt;

  -- Only what has not arrived yet, priced as ordered.
  insert into core.receipt_lines
    (receipt_id, po_line_id, product_id, qty_received, invoice_unit_cost)
  select v_receipt, l.id, l.product_id, l.qty_ordered - l.qty_received, l.unit_cost
    from core.purchase_order_lines l
   where l.po_id = p_po_id
     and l.qty_ordered - l.qty_received > 0;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    delete from core.receipts where id = v_receipt;
    raise exception 'everything on this order has already been received'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  return v_receipt;
end $$;

-- ---------------------------------------------------------------------------
-- Barcodes
--
-- A carton and a single sachet of the same product carry different codes, so a
-- barcode identifies a product AND the packaging level it was scanned at.
-- ---------------------------------------------------------------------------
create or replace function public.add_product_barcode(
  p_product_id uuid,
  p_barcode    text,
  p_unit       text default null,
  p_is_primary boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_unit text;
  v_id   uuid;
begin
  perform core.require_owner();

  if coalesce(btrim(p_barcode), '') = '' then
    raise exception 'scan or type a barcode' using errcode = 'invalid_parameter_value';
  end if;

  v_unit := coalesce(nullif(btrim(p_unit), ''), (select base_unit from core.products where id = p_product_id));

  -- Only one primary per product, so a scan with no unit given is unambiguous.
  if p_is_primary then
    update core.product_barcodes set is_primary = false where product_id = p_product_id;
  end if;

  insert into core.product_barcodes (product_id, barcode, unit, is_primary)
  values (p_product_id, btrim(p_barcode), v_unit, p_is_primary)
  on conflict (barcode) do update
     set product_id = excluded.product_id,
         unit       = excluded.unit,
         is_primary = excluded.is_primary
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.remove_product_barcode(p_barcode text)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  delete from core.product_barcodes where barcode = btrim(p_barcode);
end $$;

/**
 * What was just scanned.
 *
 * Returns the product plus how much of it is at the given location, so a
 * scanner can show "Rice 25kg — 40 in the warehouse" without a second round
 * trip. Cost is masked exactly as everywhere else.
 */
create or replace function public.lookup_barcode(
  p_barcode     text,
  p_location_id uuid default null
)
returns table (
  product_id   uuid,
  sku          text,
  product_name text,
  unit         text,
  base_unit    text,
  qty_on_hand  numeric,
  stock_value  text,
  retail_price text,
  wholesale_price text
)
language sql
stable
security definer
set search_path = core, public
as $$
  select p.id,
         p.sku,
         p.name,
         b.unit,
         p.base_unit,
         coalesce(sl.qty_on_hand, 0),
         case when public.is_owner() then coalesce(sl.total_cost_value, 0)::text end,
         p.retail_price::text,
         p.wholesale_price::text
    from core.product_barcodes b
    join core.products p on p.id = b.product_id
    left join core.stock_levels sl
           on sl.product_id = p.id
          and sl.location_id = p_location_id
   where b.barcode = btrim(p_barcode)
     and auth.uid() is not null
$$;

drop view if exists public.v_product_barcodes;
create or replace view public.v_product_barcodes
  with (security_barrier = true, security_invoker = false) as
select b.id, b.product_id, b.barcode, b.unit, b.is_primary, p.sku, p.name as product_name
  from core.product_barcodes b
  join core.products p on p.id = b.product_id
 where auth.uid() is not null;

-- ---------------------------------------------------------------------------
drop view if exists public.v_purchase_orders;
create or replace view public.v_purchase_orders
  with (security_barrier = true, security_invoker = false) as
select po.id,
       po.po_no,
       po.supplier_id,
       s.name as supplier_name,
       po.location_id,
       l.code as location_code,
       po.status,
       po.ordered_at,
       po.expected_at,
       case when public.is_owner() then po.subtotal::text end as subtotal,
       case when public.is_owner() then po.total::text    end as total,
       po.notes,
       (select count(*) from core.purchase_order_lines pl where pl.po_id = po.id) as line_count,
       (select coalesce(sum(pl.qty_ordered - pl.qty_received), 0)
          from core.purchase_order_lines pl where pl.po_id = po.id) as qty_outstanding
  from core.purchase_orders po
  join core.suppliers s  on s.id = po.supplier_id
  join core.locations l  on l.id = po.location_id
 where public.current_user_role() in ('owner', 'warehouse_staff');

drop view if exists public.v_purchase_order_lines;
create or replace view public.v_purchase_order_lines
  with (security_barrier = true, security_invoker = false) as
select pl.id,
       pl.po_id,
       pl.product_id,
       p.sku,
       p.name as product_name,
       p.base_unit,
       pl.qty_ordered,
       pl.qty_received,
       (pl.qty_ordered - pl.qty_received) as qty_outstanding,
       case when public.is_owner() then pl.unit_cost::text  end as unit_cost,
       case when public.is_owner() then pl.line_total::text end as line_total
  from core.purchase_order_lines pl
  join core.products p on p.id = pl.product_id
 where public.current_user_role() in ('owner', 'warehouse_staff');

grant select on public.v_purchase_orders, public.v_purchase_order_lines, public.v_product_barcodes
  to authenticated;

revoke all on function public.create_purchase_order(uuid, uuid, timestamptz, text) from public;
revoke all on function public.set_po_line(uuid, uuid, numeric, numeric) from public;
revoke all on function public.set_po_status(uuid, text) from public;
revoke all on function public.create_receipt_from_po(uuid) from public;
revoke all on function public.add_product_barcode(uuid, text, text, boolean) from public;
revoke all on function public.remove_product_barcode(text) from public;
revoke all on function public.lookup_barcode(text, uuid) from public;

grant execute on function public.create_purchase_order(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.set_po_line(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.set_po_status(uuid, text) to authenticated;
grant execute on function public.create_receipt_from_po(uuid) to authenticated;
grant execute on function public.add_product_barcode(uuid, text, text, boolean) to authenticated;
grant execute on function public.remove_product_barcode(text) to authenticated;
grant execute on function public.lookup_barcode(text, uuid) to authenticated;
