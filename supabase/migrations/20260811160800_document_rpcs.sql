-- 15 · Document RPCs
--
-- post_movement() moves one product at one location. A real operation is
-- multi-line and often two-sided, and it must commit whole or not at all --
-- stock and its cost counterpart cannot be allowed to move independently. Each
-- of these is one transaction.

create or replace function core.transit_location_id()
returns uuid
language sql
stable
set search_path = core, public
as $$
  select id from core.locations where kind = 'in_transit' and is_active
$$;

create or replace function core.require_owner()
returns void
language plpgsql
stable
as $$
begin
  if not public.is_owner() then
    raise exception 'only an owner may do this'
      using errcode = 'insufficient_privilege';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- post_receipt -- goods in
--
-- Delivery charges are spread across the lines by value before anything is
-- costed, because the batch must be valued at LANDED cost. Valuing at invoice
-- cost understates inventory and inflates every margin measured against it.
-- ---------------------------------------------------------------------------
create or replace function public.post_receipt(
  p_receipt_id   uuid,
  p_client_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor    uuid := auth.uid();
  v_role     public.user_role := public.current_user_role();
  v_receipt  core.receipts;
  v_charges  numeric(18, 6);
  v_base     numeric(18, 6);
  v_running  numeric(18, 6) := 0;
  v_group    uuid := gen_random_uuid();
  v_line     record;
  v_movement uuid;
  v_batch    uuid;
  v_share    numeric(18, 6);
  v_count    int := 0;
  v_index    int := 0;
begin
  select * into v_receipt from core.receipts where id = p_receipt_id for update;
  if v_receipt.id is null then
    raise exception 'receipt % not found', p_receipt_id using errcode = 'no_data_found';
  end if;

  if v_receipt.status <> 'draft' then
    raise exception 'receipt % is already %', v_receipt.grn_no, v_receipt.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not core.can_post(v_actor, v_role, 'receipt', v_receipt.location_id) then
    raise exception 'your role may not receive stock at this location'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_count from core.receipt_lines where receipt_id = p_receipt_id;
  if v_count = 0 then
    raise exception 'receipt % has no lines', v_receipt.grn_no
      using errcode = 'invalid_parameter_value';
  end if;

  v_charges := v_receipt.freight_total + v_receipt.duty_total + v_receipt.other_total;

  select coalesce(sum(qty_received * invoice_unit_cost), 0)
    into v_base
    from core.receipt_lines
   where receipt_id = p_receipt_id;

  for v_line in
    select * from core.receipt_lines where receipt_id = p_receipt_id order by id
  loop
    v_index := v_index + 1;

    if v_charges = 0 or v_base = 0 then
      v_share := 0;
    elsif v_index = v_count then
      -- Last line absorbs the rounding residue so the charges allocated sum to
      -- exactly what the delivery was charged -- no cedi appears or vanishes.
      v_share := v_charges - v_running;
    else
      v_share := round(v_charges * (v_line.qty_received * v_line.invoice_unit_cost) / v_base, 6);
      v_running := v_running + v_share;
    end if;

    update core.receipt_lines
       set allocated_charges = v_share
     where id = v_line.id
    returning landed_unit_cost into v_share;   -- recomputed generated column

    v_movement := core.post_movement(
      p_type               => 'receipt',
      p_product_id         => v_line.product_id,
      p_location_id        => v_receipt.location_id,
      p_qty                => v_line.qty_received,
      p_actor              => v_actor,
      p_occurred_at        => v_receipt.received_at,
      p_unit_cost          => v_share,
      p_movement_group_id  => v_group,
      p_client_token       => null,
      p_receipt_line_id    => v_line.id,
      p_lot_code           => v_line.lot_code,
      p_expiry_date        => v_line.expiry_date,
      p_supplier_id        => v_receipt.supplier_id,
      p_origin_received_at => v_receipt.received_at
    );

    select id into v_batch from core.stock_batches where created_movement_id = v_movement;
    update core.receipt_lines set batch_id = v_batch where id = v_line.id;

    if v_line.po_line_id is not null then
      update core.purchase_order_lines
         set qty_received = qty_received + v_line.qty_received
       where id = v_line.po_line_id;
    end if;

    -- last_cost is what the next PO should be priced against; avg_cost is the
    -- weighted average across everything still on hand anywhere.
    update core.products p
       set last_cost = v_share,
           avg_cost = (
             select case when sum(b.qty_remaining) > 0
                         then round(sum(b.qty_remaining * b.unit_cost) / sum(b.qty_remaining), 6)
                    end
               from core.stock_batches b
              where b.product_id = p.id and b.qty_remaining > 0
           )
     where p.id = v_line.product_id;
  end loop;

  if v_receipt.po_id is not null then
    update core.purchase_orders po
       set status = case
             when not exists (
               select 1 from core.purchase_order_lines l
                where l.po_id = po.id and l.qty_received < l.qty_ordered
             ) then 'received'
             else 'partially_received'
           end
     where po.id = v_receipt.po_id
       and po.status not in ('cancelled', 'closed');
  end if;

  update core.receipts
     set status = 'posted', posted_at = now(), posted_by = v_actor
   where id = p_receipt_id;

  return v_group;
end $$;

-- ---------------------------------------------------------------------------
-- post_transfer_dispatch -- warehouse -> in_transit
--
-- One destination batch per source batch drawn. A dispatch pulling from three
-- warehouse batches at three costs creates three in-transit batches, each
-- keeping its own cost and its lineage back to the batch it came from.
-- Collapsing them into one averaged batch would destroy per-batch cost and
-- quietly corrupt margin once the goods reach the shop.
-- ---------------------------------------------------------------------------
create or replace function public.post_transfer_dispatch(
  p_transfer_id  uuid,
  p_client_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor    uuid := auth.uid();
  v_role     public.user_role := public.current_user_role();
  v_transfer core.transfers;
  v_transit  uuid := core.transit_location_id();
  v_group    uuid := gen_random_uuid();
  v_line     record;
  v_draw     record;
  v_out_mv   uuid;
  v_net      numeric(18, 6);
begin
  select * into v_transfer from core.transfers where id = p_transfer_id for update;
  if v_transfer.id is null then
    raise exception 'transfer % not found', p_transfer_id using errcode = 'no_data_found';
  end if;

  if v_transfer.status <> 'draft' then
    raise exception 'transfer % is already %', v_transfer.transfer_no, v_transfer.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if v_transit is null then
    raise exception 'no active in_transit location is configured'
      using errcode = 'no_data_found';
  end if;

  if not core.can_post(v_actor, v_role, 'transfer_out', v_transfer.from_location_id) then
    raise exception 'your role may not dispatch stock from this location'
      using errcode = 'insufficient_privilege';
  end if;

  for v_line in
    select * from core.transfer_lines
     where transfer_id = p_transfer_id and qty_dispatched > 0
     order by id
  loop
    v_out_mv := core.post_movement(
      p_type              => 'transfer_out',
      p_product_id        => v_line.product_id,
      p_location_id       => v_transfer.from_location_id,
      p_qty               => v_line.qty_dispatched,
      p_actor             => v_actor,
      p_movement_group_id => v_group,
      p_transfer_line_id  => v_line.id
    );

    -- Mirror each FIFO draw into its own in-transit batch.
    for v_draw in
      select a.batch_id, -a.qty_delta as qty, a.unit_cost,
             b.origin_received_at, b.lot_code, b.expiry_date, b.supplier_id
        from core.movement_batch_allocations a
        join core.stock_batches b on b.id = a.batch_id
       where a.movement_id = v_out_mv
       order by b.origin_received_at, b.id
    loop
      perform core.post_movement(
        p_type               => 'transfer_in',
        p_product_id         => v_line.product_id,
        p_location_id        => v_transit,
        p_qty                => v_draw.qty,
        p_actor              => v_actor,
        p_unit_cost          => v_draw.unit_cost,
        p_movement_group_id  => v_group,
        p_transfer_line_id   => v_line.id,
        p_lot_code           => v_draw.lot_code,
        p_expiry_date        => v_draw.expiry_date,
        p_supplier_id        => v_draw.supplier_id,
        p_origin_received_at => v_draw.origin_received_at,
        p_parent_batch_id    => v_draw.batch_id
      );
    end loop;
  end loop;

  -- A transfer moves value between locations; it must not create or destroy
  -- any. Asserting it here catches a costing mistake at the moment it happens
  -- rather than as an unexplained drift weeks later.
  select coalesce(sum(value_delta), 0) into v_net
    from core.stock_movements where movement_group_id = v_group;

  if v_net <> 0 then
    raise exception 'transfer is not value-neutral: net % -- refusing to commit', v_net
      using errcode = 'check_violation';
  end if;

  update core.transfers
     set status = 'dispatched', dispatched_at = now(), dispatched_by = v_actor
   where id = p_transfer_id;

  return v_group;
end $$;

-- ---------------------------------------------------------------------------
-- post_transfer_receive -- in_transit -> destination
--
-- Receiving less than was dispatched is allowed and is not silently absorbed:
-- the difference stays in in_transit, where the valuation report keeps
-- reporting it until someone writes it off or explains it.
-- ---------------------------------------------------------------------------
create or replace function public.post_transfer_receive(
  p_transfer_id  uuid,
  p_received     jsonb,
  p_client_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor    uuid := auth.uid();
  v_role     public.user_role := public.current_user_role();
  v_transfer core.transfers;
  v_transit  uuid := core.transit_location_id();
  v_group    uuid := gen_random_uuid();
  v_entry    record;
  v_line     core.transfer_lines;
  v_out_mv   uuid;
  v_draw     record;
  v_net      numeric(18, 6);
begin
  select * into v_transfer from core.transfers where id = p_transfer_id for update;
  if v_transfer.id is null then
    raise exception 'transfer % not found', p_transfer_id using errcode = 'no_data_found';
  end if;

  if v_transfer.status <> 'dispatched' then
    raise exception 'transfer % is %, not dispatched', v_transfer.transfer_no, v_transfer.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not core.can_post(v_actor, v_role, 'transfer_in', v_transfer.to_location_id) then
    raise exception 'your role may not receive stock at this location'
      using errcode = 'insufficient_privilege';
  end if;

  for v_entry in
    select (e ->> 'line_id')::uuid as line_id, (e ->> 'qty')::numeric as qty
      from jsonb_array_elements(p_received) e
  loop
    if v_entry.qty is null or v_entry.qty <= 0 then
      continue;
    end if;

    select * into v_line from core.transfer_lines
     where id = v_entry.line_id and transfer_id = p_transfer_id;

    if v_line.id is null then
      raise exception 'line % does not belong to transfer %', v_entry.line_id, v_transfer.transfer_no
        using errcode = 'foreign_key_violation';
    end if;

    if v_entry.qty > v_line.qty_dispatched - v_line.qty_received then
      raise exception 'cannot receive % of %: only % remain in transit',
        v_entry.qty, v_line.product_id, v_line.qty_dispatched - v_line.qty_received
        using errcode = 'check_violation';
    end if;

    v_out_mv := core.post_movement(
      p_type              => 'transfer_out',
      p_product_id        => v_line.product_id,
      p_location_id       => v_transit,
      p_qty               => v_entry.qty,
      p_actor             => v_actor,
      p_movement_group_id => v_group,
      p_transfer_line_id  => v_line.id
    );

    for v_draw in
      select a.batch_id, -a.qty_delta as qty, a.unit_cost,
             b.origin_received_at, b.lot_code, b.expiry_date, b.supplier_id
        from core.movement_batch_allocations a
        join core.stock_batches b on b.id = a.batch_id
       where a.movement_id = v_out_mv
       order by b.origin_received_at, b.id
    loop
      perform core.post_movement(
        p_type               => 'transfer_in',
        p_product_id         => v_line.product_id,
        p_location_id        => v_transfer.to_location_id,
        p_qty                => v_draw.qty,
        p_actor              => v_actor,
        p_unit_cost          => v_draw.unit_cost,
        p_movement_group_id  => v_group,
        p_transfer_line_id   => v_line.id,
        p_lot_code           => v_draw.lot_code,
        p_expiry_date        => v_draw.expiry_date,
        p_supplier_id        => v_draw.supplier_id,
        p_origin_received_at => v_draw.origin_received_at,
        p_parent_batch_id    => v_draw.batch_id
      );
    end loop;

    update core.transfer_lines
       set qty_received = qty_received + v_entry.qty
     where id = v_line.id;
  end loop;

  select coalesce(sum(value_delta), 0) into v_net
    from core.stock_movements where movement_group_id = v_group;

  if v_net <> 0 then
    raise exception 'transfer receipt is not value-neutral: net %', v_net
      using errcode = 'check_violation';
  end if;

  update core.transfers
     set status = 'received', received_at = now(), received_by = v_actor
   where id = p_transfer_id;

  return v_group;
end $$;

-- ---------------------------------------------------------------------------
-- reverse_movement -- the only way to undo a posting
--
-- Returns units to the exact batches they came from, at the exact cost they
-- left at, so FIFO order is not perturbed: the units resume their old place in
-- the queue instead of jumping to the front. This is only possible because
-- every allocation records its batch_id.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_movement(
  p_movement_id uuid,
  p_reason      text
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor    uuid := auth.uid();
  v_original core.stock_movements;
  v_reversal uuid;
  v_touched  int;
begin
  perform core.require_owner();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reversal must state a reason'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_original from core.stock_movements where id = p_movement_id;
  if v_original.id is null then
    raise exception 'movement % not found', p_movement_id using errcode = 'no_data_found';
  end if;

  if v_original.reverses_movement_id is not null then
    raise exception 'movement % is itself a reversal', p_movement_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if exists (select 1 from core.stock_movements where reverses_movement_id = p_movement_id) then
    raise exception 'movement % has already been reversed', p_movement_id
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  -- Un-receiving goods that have already moved on is not possible: the units
  -- this movement brought in are no longer all here. Reverse what happened to
  -- them first.
  if core.movement_direction(v_original.type) > 0 then
    select count(*) into v_touched
      from core.stock_batches b
      join core.movement_batch_allocations a on a.batch_id = b.id
     where a.movement_id = p_movement_id
       and b.qty_remaining < b.qty_received;

    if v_touched > 0 then
      raise exception 'batch has already been drawn from; reverse the downstream movements first'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_original.product_id::text || ':' || v_original.location_id::text, 42)
  );

  insert into core.stock_movements (
    type, product_id, location_id, qty_delta, value_delta, unit_price,
    movement_group_id, reverses_movement_id, correction_group_id, reason,
    occurred_at, period_id, created_by
  ) values (
    v_original.type, v_original.product_id, v_original.location_id,
    -v_original.qty_delta, -v_original.value_delta, v_original.unit_price,
    v_original.movement_group_id, v_original.id, v_original.correction_group_id, p_reason,
    now(), core.period_for(now()), v_actor
  )
  returning id into v_reversal;

  insert into core.movement_batch_allocations (movement_id, batch_id, qty_delta, unit_cost)
  select v_reversal, batch_id, -qty_delta, unit_cost
    from core.movement_batch_allocations
   where movement_id = p_movement_id;

  return v_reversal;
end $$;

revoke all on function public.post_receipt(uuid, uuid) from public;
revoke all on function public.post_transfer_dispatch(uuid, uuid) from public;
revoke all on function public.post_transfer_receive(uuid, jsonb, uuid) from public;
revoke all on function public.reverse_movement(uuid, text) from public;

grant execute on function public.post_receipt(uuid, uuid) to authenticated;
grant execute on function public.post_transfer_dispatch(uuid, uuid) to authenticated;
grant execute on function public.post_transfer_receive(uuid, jsonb, uuid) to authenticated;
grant execute on function public.reverse_movement(uuid, text) to authenticated;
