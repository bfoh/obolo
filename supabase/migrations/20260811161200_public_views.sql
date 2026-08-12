-- 19 · The read surface
--
-- Views rather than a hand-written RPC per query. Revoking the column and
-- serving a fixed-shape get_products() function -- the approach OBOLO's
-- predecessor took -- also costs the OWNER PostgREST: every filter, sort, page
-- and join becomes another RPC. That does not scale past a handful of tables.
--
-- A view owned by postgres executes with the view owner's privileges
-- (security_invoker defaults to false), so it can read core tables that
-- `authenticated` cannot touch at all, and hand back a masked projection. The
-- client keeps the full PostgREST query surface:
--   /rest/v1/v_stock_levels?location_id=eq.X&order=qty_on_hand.desc&limit=50
--
-- Two things make this safe and both are required:
--
--   security_barrier = true  stops predicate push-down of user-supplied leaky
--     functions. Without it a filter like `where 1/(total_cost_value - 12.5) > 0`
--     leaks a masked value through a division-by-zero error. This is a real
--     attack, not a theoretical one, and it is easy to miss because the view
--     otherwise looks correct.
--
--   Explicit predicates  because a definer view bypasses RLS on its base
--     tables. Location scoping lives in the view, not in a policy it skips.

-- Dropped before creating, for the same reason as valuation_summary: a later
-- migration retypes several of these columns from numeric to text, and CREATE
-- OR REPLACE VIEW cannot change a column's type. Replaying the sequence in
-- order still ends correctly -- this recreates the original shape and migration
-- 23 supersedes it.
drop view if exists public.v_locations;
drop view if exists public.v_products;
drop view if exists public.v_stock_levels;
drop view if exists public.v_stock_batches;
drop view if exists public.v_stock_movements;
drop view if exists public.v_low_stock;
drop view if exists public.v_expiring_soon;
drop view if exists public.v_transfers;
drop view if exists public.v_transfer_lines;
drop view if exists public.v_suppliers;
drop view if exists public.v_receipts;
drop view if exists public.v_receipt_lines;

-- ---------------------------------------------------------------------------
create or replace view public.v_locations
  with (security_barrier = true, security_invoker = false) as
select l.id, l.code, l.name, l.kind, l.is_active
  from core.locations l
 where l.is_active
   and public.can_access_location(l.id);

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
       p.wholesale_price,
       p.retail_price,
       case when public.is_owner() then p.last_cost end as last_cost,
       case when public.is_owner() then p.avg_cost  end as avg_cost,
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
       case when public.is_owner() then sl.total_cost_value end as total_cost_value,
       case when public.is_owner() and sl.qty_on_hand > 0
            then round(sl.total_cost_value / sl.qty_on_hand, 6)
       end as avg_unit_cost,
       p.reorder_point,
       sl.updated_at
  from core.stock_levels sl
  join core.products p  on p.id = sl.product_id
  join core.locations l on l.id = sl.location_id
 where public.can_access_location(sl.location_id);

-- ---------------------------------------------------------------------------
-- The Batch Column reads from this: one row per stratum of stock, oldest first.
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
       case when public.is_owner() then b.unit_cost end as unit_cost,
       case when public.is_owner() then round(b.qty_remaining * b.unit_cost, 6) end as remaining_value,
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
       case when public.is_owner() then m.value_delta end as value_delta,
       m.unit_price,
       m.movement_group_id,
       m.reverses_movement_id,
       -- Derived rather than stored: the ledger is append-only, so a movement
       -- is never edited to mark it void.
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
create or replace view public.v_low_stock
  with (security_barrier = true, security_invoker = false) as
select sl.product_id,
       p.sku,
       p.name as product_name,
       sl.location_id,
       l.code as location_code,
       sl.qty_on_hand,
       p.reorder_point,
       p.reorder_qty
  from core.stock_levels sl
  join core.products p  on p.id = sl.product_id
  join core.locations l on l.id = sl.location_id
 where p.is_active
   and p.reorder_point is not null
   and sl.qty_on_hand <= p.reorder_point
   and public.can_access_location(sl.location_id);

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
       case when public.is_owner() then round(b.qty_remaining * b.unit_cost, 6) end as at_risk_value,
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
create or replace view public.v_transfers
  with (security_barrier = true, security_invoker = false) as
select t.id,
       t.transfer_no,
       t.from_location_id,
       fl.code as from_code,
       t.to_location_id,
       tl.code as to_code,
       t.status,
       t.dispatched_at,
       t.received_at,
       t.notes,
       t.created_at
  from core.transfers t
  join core.locations fl on fl.id = t.from_location_id
  join core.locations tl on tl.id = t.to_location_id
 where public.can_access_location(t.from_location_id)
    or public.can_access_location(t.to_location_id);

create or replace view public.v_transfer_lines
  with (security_barrier = true, security_invoker = false) as
select tl.id,
       tl.transfer_id,
       tl.product_id,
       p.sku,
       p.name as product_name,
       p.base_unit,
       tl.qty_requested,
       tl.qty_dispatched,
       tl.qty_received,
       (tl.qty_dispatched - tl.qty_received) as qty_in_transit
  from core.transfer_lines tl
  join core.products p  on p.id = tl.product_id
  join core.transfers t on t.id = tl.transfer_id
 where public.can_access_location(t.from_location_id)
    or public.can_access_location(t.to_location_id);

-- ---------------------------------------------------------------------------
-- Purchasing. Retail staff have no business here at all, so the predicate is a
-- capability check rather than a location one.
create or replace view public.v_suppliers
  with (security_barrier = true, security_invoker = false) as
select s.id, s.code, s.name, s.phone, s.email, s.address,
       s.payment_terms_days, s.currency, s.is_active
  from core.suppliers s
 where public.current_user_role() in ('owner', 'warehouse_staff');

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
       case when public.is_owner() then r.freight_total end as freight_total,
       case when public.is_owner() then r.duty_total    end as duty_total,
       case when public.is_owner() then r.other_total   end as other_total,
       r.posted_at
  from core.receipts r
  join core.locations l      on l.id = r.location_id
  left join core.suppliers s on s.id = r.supplier_id
 where public.current_user_role() in ('owner', 'warehouse_staff')
   and public.can_access_location(r.location_id);

create or replace view public.v_receipt_lines
  with (security_barrier = true, security_invoker = false) as
select rl.id,
       rl.receipt_id,
       rl.product_id,
       p.sku,
       p.name as product_name,
       rl.qty_received,
       case when public.is_owner() then rl.invoice_unit_cost end as invoice_unit_cost,
       case when public.is_owner() then rl.allocated_charges end as allocated_charges,
       case when public.is_owner() then rl.landed_unit_cost  end as landed_unit_cost,
       rl.expiry_date,
       rl.lot_code,
       rl.batch_id
  from core.receipt_lines rl
  join core.products p on p.id = rl.product_id
  join core.receipts r on r.id = rl.receipt_id
 where public.current_user_role() in ('owner', 'warehouse_staff')
   and public.can_access_location(r.location_id);

-- ---------------------------------------------------------------------------
grant select on
  public.v_locations,
  public.v_products,
  public.v_stock_levels,
  public.v_stock_batches,
  public.v_stock_movements,
  public.v_low_stock,
  public.v_expiring_soon,
  public.v_transfers,
  public.v_transfer_lines,
  public.v_suppliers,
  public.v_receipts,
  public.v_receipt_lines
to authenticated;

revoke all on function public.valuation_summary(timestamptz) from public;
grant execute on function public.valuation_summary(timestamptz) to authenticated;
revoke all on function public.valuation_at(timestamptz, uuid) from public;
grant execute on function public.valuation_at(timestamptz, uuid) to authenticated;
