-- 14 · post_movement -- the primitive every stock operation is built from
--
-- Concurrency. Two issues that both read a batch at 10 units and each allocate
-- 8 must not both succeed. Five layers stop that:
--
--   1. No write path outside this function. Base tables live in `core`, which
--      PostgREST does not serve, so there is no client-issued UPDATE to lose.
--   2. A per-(product, location) advisory lock taken before any read. This
--      fully serialises allocation for one product at one location and removes
--      a deadlock class that SELECT ... FOR UPDATE alone does not: under
--      contention Postgres may hand back locked rows in a different order than
--      the ORDER BY implies, so two multi-batch allocations can grab batches in
--      opposite orders. Different products never contend.
--   3. FOR UPDATE on the batch cursor anyway.
--   4. CHECK (qty_remaining between 0 and qty_received) on the batch row.
--   5. An idempotency token, so a retried request returns the original id.
--
-- Overselling is refused outright. For an app whose purpose is knowing what
-- stock is worth, unbacked stock must be impossible. A real physical oversell
-- is corrected by an owner-approved count adjustment at a stated cost --
-- visible, attributed and reversible -- not by booking a zero-cost sale that
-- reports 100% margin and hides the shortfall.

create or replace function core.post_movement(
  p_type               public.movement_type,
  p_product_id         uuid,
  p_location_id        uuid,
  p_qty                numeric,
  p_actor              uuid,
  p_occurred_at        timestamptz default now(),
  p_unit_cost          numeric default null,
  p_unit_price         numeric default null,
  p_movement_group_id  uuid default null,
  p_reason             text default null,
  p_client_token       uuid default null,
  p_receipt_line_id    uuid default null,
  p_transfer_line_id   uuid default null,
  p_lot_code           text default null,
  p_expiry_date        date default null,
  p_supplier_id        uuid default null,
  p_origin_received_at timestamptz default null,
  p_parent_batch_id    uuid default null,
  p_target_batch_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_dir         int;
  v_movement_id uuid;
  v_period_id   uuid;
  v_group_id    uuid;
  v_batch_id    uuid;
  v_unit_cost   numeric(18, 6);
  v_value       numeric(18, 6) := 0;
  v_remaining   numeric(14, 3);
  v_take        numeric(14, 3);
  v_draws       jsonb := '[]'::jsonb;
  r             record;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'quantity must be positive, got %', p_qty
      using errcode = 'invalid_parameter_value';
  end if;

  if p_actor is null then
    raise exception 'a movement must be attributed to a user'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Idempotency, checked before anything else so a replay costs one index hit.
  if p_client_token is not null then
    select id into v_movement_id
      from core.stock_movements
     where client_token = p_client_token;
    if v_movement_id is not null then
      return v_movement_id;
    end if;
  end if;

  v_dir       := core.movement_direction(p_type);
  v_period_id := core.period_for(p_occurred_at);   -- raises if missing or closed
  v_group_id  := coalesce(p_movement_group_id, gen_random_uuid());

  perform pg_advisory_xact_lock(
    hashtextextended(p_product_id::text || ':' || p_location_id::text, 42)
  );

  if v_dir > 0 then
    -- ---------------------------------------------------------------------
    -- Inbound
    -- ---------------------------------------------------------------------
    if p_target_batch_id is not null then
      -- Returning units to the batch they came from, at the cost they left at,
      -- so they resume their original place in the FIFO queue rather than
      -- jumping to the head of it.
      select unit_cost into v_unit_cost
        from core.stock_batches
       where id = p_target_batch_id
         and product_id = p_product_id
         and location_id = p_location_id
       for update;

      if v_unit_cost is null then
        raise exception 'target batch % is not a batch of this product at this location', p_target_batch_id
          using errcode = 'foreign_key_violation';
      end if;

      v_batch_id := p_target_batch_id;
    else
      if p_unit_cost is null then
        raise exception 'unit cost is required to bring % into stock', p_type
          using errcode = 'invalid_parameter_value',
                hint = 'Inbound stock must be priced, or the valuation is wrong from the first day.';
      end if;
      v_unit_cost := p_unit_cost;
    end if;

    v_value := round(p_qty * v_unit_cost, 6);

    insert into core.stock_movements (
      type, product_id, location_id, qty_delta, value_delta, unit_price,
      movement_group_id, reason, receipt_line_id, transfer_line_id,
      occurred_at, period_id, client_token, created_by
    ) values (
      p_type, p_product_id, p_location_id, p_qty, v_value, p_unit_price,
      v_group_id, p_reason, p_receipt_line_id, p_transfer_line_id,
      p_occurred_at, v_period_id, p_client_token, p_actor
    )
    returning id into v_movement_id;

    if v_batch_id is null then
      insert into core.stock_batches (
        product_id, location_id, parent_batch_id, lot_code, qty_received,
        unit_cost, origin_received_at, received_at, expiry_date, supplier_id,
        receipt_line_id, created_movement_id
      ) values (
        p_product_id, p_location_id, p_parent_batch_id, p_lot_code, p_qty,
        v_unit_cost, coalesce(p_origin_received_at, p_occurred_at), p_occurred_at,
        p_expiry_date, p_supplier_id, p_receipt_line_id, v_movement_id
      )
      returning id into v_batch_id;
    end if;

    -- qty_remaining starts at zero and is brought up by this allocation, so it
    -- is always exactly the sum of the batch's allocations.
    insert into core.movement_batch_allocations (movement_id, batch_id, qty_delta, unit_cost)
    values (v_movement_id, v_batch_id, p_qty, v_unit_cost);

  else
    -- ---------------------------------------------------------------------
    -- Outbound: draw FIFO, oldest goods first
    -- ---------------------------------------------------------------------
    v_remaining := p_qty;

    for r in
      select id, qty_remaining, unit_cost
        from core.stock_batches
       where product_id = p_product_id
         and location_id = p_location_id
         and qty_remaining > 0
       order by origin_received_at, id
       for update
    loop
      exit when v_remaining <= 0;

      v_take  := least(r.qty_remaining, v_remaining);
      v_draws := v_draws || jsonb_build_array(
                   jsonb_build_object('batch', r.id, 'qty', v_take, 'cost', r.unit_cost)
                 );
      -- Rounded per draw so this total matches the sum of the generated
      -- value_delta columns exactly.
      v_value     := v_value + round(v_take * r.unit_cost, 6);
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      raise exception 'insufficient stock: short by % of % units', v_remaining, p_qty
        using errcode = 'check_violation',
              hint = 'If the shortfall is real, post an owner-approved count adjustment.';
    end if;

    insert into core.stock_movements (
      type, product_id, location_id, qty_delta, value_delta, unit_price,
      movement_group_id, reason, receipt_line_id, transfer_line_id,
      occurred_at, period_id, client_token, created_by
    ) values (
      p_type, p_product_id, p_location_id, -p_qty, -v_value, p_unit_price,
      v_group_id, p_reason, p_receipt_line_id, p_transfer_line_id,
      p_occurred_at, v_period_id, p_client_token, p_actor
    )
    returning id into v_movement_id;

    insert into core.movement_batch_allocations (movement_id, batch_id, qty_delta, unit_cost)
    select v_movement_id,
           (d ->> 'batch')::uuid,
           -((d ->> 'qty')::numeric),
           (d ->> 'cost')::numeric
      from jsonb_array_elements(v_draws) d;
  end if;

  return v_movement_id;
end $$;

-- ---------------------------------------------------------------------------
-- What a client may call directly: a standalone, single-line posting.
--
-- Multi-line operations (a delivery, a transfer, a sale) go through their own
-- document RPC so that all of their legs commit or none do.
-- ---------------------------------------------------------------------------
create or replace function public.post_movement(
  p_type          public.movement_type,
  p_product_id    uuid,
  p_location_id   uuid,
  p_qty           numeric,
  p_reason        text default null,
  p_client_token  uuid default null,
  p_occurred_at   timestamptz default now(),
  p_unit_cost     numeric default null,
  p_unit_price    numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  public.user_role := public.current_user_role();
begin
  if not core.can_post(v_actor, v_role, p_type, p_location_id) then
    raise exception 'your role may not post % at this location', p_type
      using errcode = 'insufficient_privilege';
  end if;

  -- A write-off or adjustment with no stated reason is the thing an auditor
  -- asks about first.
  if p_type in ('damage', 'expiry_writeoff', 'supplier_return')
     and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a % must state a reason', p_type
      using errcode = 'invalid_parameter_value';
  end if;

  return core.post_movement(
    p_type              => p_type,
    p_product_id        => p_product_id,
    p_location_id       => p_location_id,
    p_qty               => p_qty,
    p_actor             => v_actor,
    p_occurred_at       => p_occurred_at,
    p_unit_cost         => p_unit_cost,
    p_unit_price        => p_unit_price,
    p_reason            => p_reason,
    p_client_token      => p_client_token
  );
end $$;

revoke all on function public.post_movement(
  public.movement_type, uuid, uuid, numeric, text, uuid, timestamptz, numeric, numeric
) from public;
grant execute on function public.post_movement(
  public.movement_type, uuid, uuid, numeric, text, uuid, timestamptz, numeric, numeric
) to authenticated;

-- Fully qualified by argument list. A later migration adds a sales-order-line
-- parameter, so while the sequence is being replayed both signatures exist at
-- this point and an unqualified name would be ambiguous.
comment on function core.post_movement(
  public.movement_type, uuid, uuid, numeric, uuid, timestamptz, numeric, numeric,
  uuid, text, uuid, uuid, uuid, text, date, uuid, timestamptz, uuid, uuid
) is 'The only way stock moves. Allocates FIFO under an advisory lock, refuses to oversell.';
