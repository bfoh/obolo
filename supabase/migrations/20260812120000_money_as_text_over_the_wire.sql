-- 23 · Money crosses the wire as text
--
-- PostgREST serialises `numeric` as a JSON *number*, which every JSON parser
-- turns into a float64. So a cost stored as numeric(18,6) -- chosen precisely
-- so that qty x cost closes exactly -- arrives in the application as a binary
-- float, and any sum taken over it is approximate. `85500.000000` comes back as
-- `85500`, and `0.1 + 0.2` problems follow it around from there.
--
-- This was invisible locally: node-postgres returns numeric as a string, so the
-- migration harness saw exact values throughout. Only a real request through
-- PostgREST shows it.
--
-- Fix at the source: every money and cost column is cast to text in the views
-- and RPCs, so the exact decimal representation survives to the client, which
-- formats it and never does arithmetic on it.
--
-- Quantities are deliberately left as JSON numbers. numeric(14,3) tops out
-- around 1e14 when scaled to an integer, comfortably inside float64's exact
-- integer range (2^53, about 9e15), and quantities need to stay numeric so
-- PostgREST can still filter and order on them (`qty_on_hand=gt.0`,
-- `order=qty_on_hand.desc`). Money is never filtered or sorted on by the
-- client, so it loses nothing by becoming text.
--
-- Totals move into SQL for the same reason: a total summed in JavaScript is a
-- float total, and this app's entire purpose is a number that agrees with the
-- ledger.

-- CREATE OR REPLACE VIEW cannot change a column's data type, and every view
-- below changes numeric columns to text, so each must be dropped first. None of
-- them is depended on by another view, so no cascade is needed -- and not using
-- cascade means this fails loudly if that ever stops being true, rather than
-- silently dropping something else.
drop view if exists public.v_products;
drop view if exists public.v_stock_levels;
drop view if exists public.v_stock_batches;
drop view if exists public.v_stock_movements;
drop view if exists public.v_expiring_soon;
drop view if exists public.v_receipts;
drop view if exists public.v_receipt_lines;

-- ---------------------------------------------------------------------------
create or replace view public.v_products
  with (security_barrier = true, security_invoker = false) as
select p.id,
       p.sku,
       p.name,
       p.category_id,
       c.name as category_name,
       p.base_unit,
       p.pack_unit,
       p.units_per_pack,
       p.wholesale_price::text as wholesale_price,
       p.retail_price::text    as retail_price,
       case when public.is_owner() then p.last_cost::text end as last_cost,
       case when public.is_owner() then p.avg_cost::text  end as avg_cost,
       p.reorder_point,
       p.reorder_qty,
       p.track_expiry,
       p.shelf_life_days,
       p.is_active,
       p.created_at,
       p.updated_at
  from core.products p
  left join core.product_categories c on c.id = p.category_id
 where auth.uid() is not null;

-- ---------------------------------------------------------------------------
create or replace view public.v_stock_levels
  with (security_barrier = true, security_invoker = false) as
select sl.product_id,
       p.sku,
       p.name as product_name,
       p.base_unit,
       sl.location_id,
       l.code as location_code,
       l.kind as location_kind,
       sl.qty_on_hand,
       case when public.is_owner() then sl.total_cost_value::text end as total_cost_value,
       case when public.is_owner() and sl.qty_on_hand > 0
            then round(sl.total_cost_value / sl.qty_on_hand, 6)::text
       end as avg_unit_cost,
       p.reorder_point,
       sl.updated_at
  from core.stock_levels sl
  join core.products p  on p.id = sl.product_id
  join core.locations l on l.id = sl.location_id
 where public.can_access_location(sl.location_id);

-- ---------------------------------------------------------------------------
create or replace view public.v_stock_batches
  with (security_barrier = true, security_invoker = false) as
select b.id,
       b.product_id,
       p.sku,
       p.name as product_name,
       b.location_id,
       l.code as location_code,
       b.lot_code,
       b.qty_received,
       b.qty_remaining,
       case when public.is_owner() then b.unit_cost::text end as unit_cost,
       case when public.is_owner() then round(b.qty_remaining * b.unit_cost, 6)::text end as remaining_value,
       b.origin_received_at,
       b.received_at,
       b.expiry_date,
       b.parent_batch_id,
       b.supplier_id
  from core.stock_batches b
  join core.products p  on p.id = b.product_id
  join core.locations l on l.id = b.location_id
 where public.can_access_location(b.location_id);

-- ---------------------------------------------------------------------------
create or replace view public.v_stock_movements
  with (security_barrier = true, security_invoker = false) as
select m.id,
       m.seq,
       m.type,
       m.product_id,
       p.sku,
       p.name as product_name,
       m.location_id,
       l.code as location_code,
       m.qty_delta,
       case when public.is_owner() then m.value_delta::text end as value_delta,
       m.unit_price::text as unit_price,
       m.movement_group_id,
       m.reverses_movement_id,
       exists (
         select 1 from core.stock_movements r where r.reverses_movement_id = m.id
       ) as is_reversed,
       m.reason,
       m.occurred_at,
       m.created_at,
       m.created_by,
       u.full_name as created_by_name
  from core.stock_movements m
  join core.products p       on p.id = m.product_id
  join core.locations l      on l.id = m.location_id
  left join core.app_users u on u.id = m.created_by
 where public.can_access_location(m.location_id);

-- ---------------------------------------------------------------------------
create or replace view public.v_expiring_soon
  with (security_barrier = true, security_invoker = false) as
select b.id as batch_id,
       b.product_id,
       p.sku,
       p.name as product_name,
       b.location_id,
       l.code as location_code,
       b.lot_code,
       b.qty_remaining,
       case when public.is_owner() then round(b.qty_remaining * b.unit_cost, 6)::text end as at_risk_value,
       b.expiry_date,
       (b.expiry_date - (now() at time zone 'UTC')::date) as days_remaining
  from core.stock_batches b
  join core.products p  on p.id = b.product_id
  join core.locations l on l.id = b.location_id
  cross join core.app_settings s
 where b.qty_remaining > 0
   and b.expiry_date is not null
   and b.expiry_date <= (now() at time zone 'UTC')::date + s.expiry_alert_days
   and public.can_access_location(b.location_id);

-- ---------------------------------------------------------------------------
-- Deliveries also gain their goods total, so the draft screen can show what is
-- about to be posted without summing the lines in the browser.
create or replace view public.v_receipts
  with (security_barrier = true, security_invoker = false) as
select r.id,
       r.grn_no,
       r.po_id,
       r.supplier_id,
       s.name as supplier_name,
       r.location_id,
       l.code as location_code,
       r.status,
       r.waybill_no,
       r.received_at,
       case when public.is_owner() then r.freight_total::text end as freight_total,
       case when public.is_owner() then r.duty_total::text    end as duty_total,
       case when public.is_owner() then r.other_total::text   end as other_total,
       case when public.is_owner()
            then (r.freight_total + r.duty_total + r.other_total)::text end as charges_total,
       case when public.is_owner() then coalesce((
              select sum(rl.qty_received * rl.invoice_unit_cost)
                from core.receipt_lines rl where rl.receipt_id = r.id
            ), 0)::text end as goods_total,
       case when public.is_owner() then coalesce((
              select sum(rl.qty_received * rl.invoice_unit_cost)
                from core.receipt_lines rl where rl.receipt_id = r.id
            ), 0)::numeric(18,6) + r.freight_total + r.duty_total + r.other_total
       end::text as landed_total,
       (select count(*) from core.receipt_lines rl where rl.receipt_id = r.id) as line_count,
       r.posted_at
  from core.receipts r
  join core.locations l      on l.id = r.location_id
  left join core.suppliers s on s.id = r.supplier_id
 where public.current_user_role() in ('owner', 'warehouse_staff')
   and public.can_access_location(r.location_id);

-- ---------------------------------------------------------------------------
create or replace view public.v_receipt_lines
  with (security_barrier = true, security_invoker = false) as
select rl.id,
       rl.receipt_id,
       rl.product_id,
       p.sku,
       p.name as product_name,
       rl.qty_received,
       case when public.is_owner() then rl.invoice_unit_cost::text end as invoice_unit_cost,
       case when public.is_owner() then rl.allocated_charges::text end as allocated_charges,
       case when public.is_owner() then rl.landed_unit_cost::text  end as landed_unit_cost,
       rl.expiry_date,
       rl.lot_code,
       rl.batch_id
  from core.receipt_lines rl
  join core.products p on p.id = rl.product_id
  join core.receipts r on r.id = rl.receipt_id
 where public.current_user_role() in ('owner', 'warehouse_staff')
   and public.can_access_location(r.location_id);

-- ---------------------------------------------------------------------------
-- valuation_summary's return type changes, so it must be dropped first --
-- CREATE OR REPLACE cannot alter a function's result type.
drop function if exists public.valuation_summary(timestamptz);

create or replace function public.valuation_summary(p_at timestamptz default now())
returns table (
  location_id   uuid,
  location_code text,
  location_name text,
  location_kind public.location_kind,
  qty_on_hand   numeric,
  total_value   text,
  product_count bigint
)
language sql
stable
security definer
set search_path = core, public
as $$
  select l.id,
         l.code,
         l.name,
         l.kind,
         coalesce(sum(v.qty), 0),
         case when public.is_owner() then coalesce(sum(v.value), 0)::text end,
         count(v.product_id) filter (where v.qty > 0)
    from core.locations l
    left join core.valuation_at(p_at) v on v.location_id = l.id
   where l.is_active
     and public.can_access_location(l.id)
   group by l.id, l.code, l.name, l.kind
   order by l.kind, l.code
$$;

revoke all on function public.valuation_summary(timestamptz) from public;
grant execute on function public.valuation_summary(timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Totals for one location, summed in SQL rather than in the browser.
create or replace function public.location_stock_totals(p_location_id uuid)
returns table (
  product_count bigint,
  total_qty     numeric,
  total_value   text
)
language sql
stable
security definer
set search_path = core, public
as $$
  select count(*) filter (where sl.qty_on_hand > 0),
         coalesce(sum(sl.qty_on_hand), 0),
         case when public.is_owner() then coalesce(sum(sl.total_cost_value), 0)::text end
    from core.stock_levels sl
   where sl.location_id = p_location_id
     and public.can_access_location(p_location_id)
$$;

revoke all on function public.location_stock_totals(uuid) from public;
grant execute on function public.location_stock_totals(uuid) to authenticated;

grant select on
  public.v_products,
  public.v_stock_levels,
  public.v_stock_batches,
  public.v_stock_movements,
  public.v_expiring_soon,
  public.v_receipts,
  public.v_receipt_lines
to authenticated;
