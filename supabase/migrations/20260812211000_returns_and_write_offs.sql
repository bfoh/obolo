-- 30 · Returns, credit notes and write-offs
--
-- A customer return is NOT a reversal of the sale. The goods come back on a
-- different day, possibly in a different condition, and often not all of them.
-- Reversing the sale would erase the fact that it happened; a return is its own
-- movement in the other direction.
--
-- Two rules do the real work:
--
-- Resalable goods go back to the batch they left, at the cost they left at, so
-- they resume their place in the FIFO queue rather than jumping to the front
-- of it as fresh stock.
--
-- Damaged goods create NO stock movement at all. They are not stock -- they are
-- rubbish with a credit note attached. Booking them back in at zero cost, which
-- is the tempting shortcut, silently inflates the margin on everything sold
-- from that product afterwards.

create sequence if not exists core.return_number_seq;
create sequence if not exists core.credit_note_number_seq;

create or replace function core.next_return_no()
returns text language sql volatile set search_path = core, public as $$
  select 'RTN-' || lpad(nextval('core.return_number_seq')::text, 5, '0')
$$;

create or replace function core.next_credit_note_no()
returns text language sql volatile set search_path = core, public as $$
  select 'CN-' || lpad(nextval('core.credit_note_number_seq')::text, 5, '0')
$$;

create table if not exists core.returns (
  id          uuid primary key default gen_random_uuid(),
  return_no   text not null unique default core.next_return_no(),
  customer_id uuid references core.customers(id) on delete restrict,
  order_id    uuid references core.sales_orders(id) on delete restrict,
  location_id uuid not null references core.locations(id) on delete restrict,
  status      text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  reason      text,
  occurred_at timestamptz not null default now(),
  created_by  uuid not null references core.app_users(id) on delete restrict,
  posted_by   uuid references core.app_users(id) on delete set null,
  posted_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_returns_customer on core.returns (customer_id, occurred_at desc);
create index if not exists idx_returns_status on core.returns (status);

create table if not exists core.return_lines (
  id                  uuid primary key default gen_random_uuid(),
  return_id           uuid not null references core.returns(id) on delete cascade,
  product_id          uuid not null references core.products(id) on delete restrict,
  qty                 numeric(14, 3) not null check (qty > 0),
  condition           text not null default 'resalable' check (condition in ('resalable', 'damaged')),
  -- The batch these units came from, when it is known.
  source_batch_id     uuid references core.stock_batches(id) on delete restrict,
  source_sale_line_id uuid references core.sales_order_lines(id) on delete restrict,
  unit_price          numeric(14, 2) not null check (unit_price >= 0),
  line_total          numeric(14, 2) generated always as (qty * unit_price) stored,
  created_at          timestamptz not null default now()
);

create index if not exists idx_return_lines_return on core.return_lines (return_id);

create table if not exists core.credit_notes (
  id          uuid primary key default gen_random_uuid(),
  cn_no       text not null unique default core.next_credit_note_no(),
  customer_id uuid not null references core.customers(id) on delete restrict,
  return_id   uuid references core.returns(id) on delete restrict,
  amount      numeric(14, 2) not null check (amount > 0),
  reason      text,
  issued_at   timestamptz not null default now(),
  issued_by   uuid not null references core.app_users(id) on delete restrict
);

alter table core.customer_ledger_entries
  drop constraint if exists customer_ledger_entries_credit_note_id_fkey;
alter table core.customer_ledger_entries
  add constraint customer_ledger_entries_credit_note_id_fkey
  foreign key (credit_note_id) references core.credit_notes(id) on delete restrict;

alter table core.stock_movements
  add column if not exists return_line_id uuid references core.return_lines(id) on delete restrict;

create index if not exists idx_mv_return_line on core.stock_movements (return_line_id);

alter table core.stock_movements drop constraint if exists mv_one_source;
alter table core.stock_movements add constraint mv_one_source
  check (num_nonnulls(receipt_line_id, transfer_line_id, sales_order_line_id, return_line_id) <= 1);

-- ---------------------------------------------------------------------------
create or replace function public.create_return(
  p_customer_id uuid default null,
  p_order_id    uuid default null,
  p_location_id uuid default null,
  p_reason      text default null
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
  if public.current_user_role() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  v_location := coalesce(
    p_location_id,
    (select location_id from core.sales_orders where id = p_order_id),
    (select id from core.locations where kind = 'retail' and is_active order by code limit 1)
  );

  if not core.can_post(auth.uid(), public.current_user_role(), 'customer_return', v_location) then
    raise exception 'your role may not take returns at this location'
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.returns (customer_id, order_id, location_id, reason, created_by)
  values (p_customer_id, p_order_id, v_location, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.set_return_line(
  p_return_id  uuid,
  p_product_id uuid,
  p_qty        numeric,
  p_condition  text default 'resalable',
  p_unit_price numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_return core.returns;
  v_price  numeric(14, 2);
  v_batch  uuid;
  v_line   uuid;
  v_id     uuid;
begin
  select * into v_return from core.returns where id = p_return_id;
  if v_return.id is null then
    raise exception 'return not found' using errcode = 'no_data_found';
  end if;

  if v_return.status <> 'draft' then
    raise exception 'this return has already been %; it can no longer be edited', v_return.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_qty is null or p_qty <= 0 then
    delete from core.return_lines where return_id = p_return_id and product_id = p_product_id;
    return null;
  end if;

  -- Credit what they were actually charged, not today's list price.
  if v_return.order_id is not null then
    select id, unit_price into v_line, v_price
      from core.sales_order_lines
     where order_id = v_return.order_id and product_id = p_product_id;

    -- And send the goods back to the batch they left on.
    select a.batch_id into v_batch
      from core.stock_movements m
      join core.movement_batch_allocations a on a.movement_id = m.id
     where m.sales_order_line_id = v_line
     order by a.qty_delta
     limit 1;
  end if;

  v_price := coalesce(p_unit_price, v_price,
                      (select retail_price from core.products where id = p_product_id));

  if v_price is null then
    raise exception 'what was this sold for? no price found to credit'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into core.return_lines
    (return_id, product_id, qty, condition, unit_price, source_batch_id, source_sale_line_id)
  values
    (p_return_id, p_product_id, p_qty, p_condition, v_price, v_batch, v_line)
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- post_movement gains a return-line link, for the same reason it gained a
-- sales-order-line one: the ledger is append-only, so a reference cannot be
-- attached after the row exists.
--
-- This is the third time this signature has grown, and the cost of that is
-- visible -- the whole body is restated each time, because adding a parameter
-- creates an overload rather than replacing the function. If a fifth source
-- document ever appears, the right move is to collapse these into one
-- (kind, id) pair routed onto the typed columns inside, rather than a
-- parameter per document type. It is not worth rewriting the existing call
-- sites for the fourth.
-- ---------------------------------------------------------------------------
drop function if exists core.post_movement(
  public.movement_type, uuid, uuid, numeric, uuid, timestamptz, numeric, numeric,
  uuid, text, uuid, uuid, uuid, text, date, uuid, timestamptz, uuid, uuid, uuid
);

create or replace function core.post_movement(
  p_type                public.movement_type,
  p_product_id          uuid,
  p_location_id         uuid,
  p_qty                 numeric,
  p_actor               uuid,
  p_occurred_at         timestamptz default now(),
  p_unit_cost           numeric default null,
  p_unit_price          numeric default null,
  p_movement_group_id   uuid default null,
  p_reason              text default null,
  p_client_token        uuid default null,
  p_receipt_line_id     uuid default null,
  p_transfer_line_id    uuid default null,
  p_lot_code            text default null,
  p_expiry_date         date default null,
  p_supplier_id         uuid default null,
  p_origin_received_at  timestamptz default null,
  p_parent_batch_id     uuid default null,
  p_target_batch_id     uuid default null,
  p_sales_order_line_id uuid default null,
  p_return_line_id      uuid default null
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

  if p_client_token is not null then
    select id into v_movement_id from core.stock_movements where client_token = p_client_token;
    if v_movement_id is not null then
      return v_movement_id;
    end if;
  end if;

  v_dir       := core.movement_direction(p_type);
  v_period_id := core.period_for(p_occurred_at);
  v_group_id  := coalesce(p_movement_group_id, gen_random_uuid());

  perform pg_advisory_xact_lock(
    hashtextextended(p_product_id::text || ':' || p_location_id::text, 42)
  );

  if v_dir > 0 then
    if p_target_batch_id is not null then
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
      movement_group_id, reason, receipt_line_id, transfer_line_id, sales_order_line_id,
      return_line_id, occurred_at, period_id, client_token, created_by
    ) values (
      p_type, p_product_id, p_location_id, p_qty, v_value, p_unit_price,
      v_group_id, p_reason, p_receipt_line_id, p_transfer_line_id, p_sales_order_line_id,
      p_return_line_id, p_occurred_at, v_period_id, p_client_token, p_actor
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

    insert into core.movement_batch_allocations (movement_id, batch_id, qty_delta, unit_cost)
    values (v_movement_id, v_batch_id, p_qty, v_unit_cost);

  else
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
      movement_group_id, reason, receipt_line_id, transfer_line_id, sales_order_line_id,
      return_line_id, occurred_at, period_id, client_token, created_by
    ) values (
      p_type, p_product_id, p_location_id, -p_qty, -v_value, p_unit_price,
      v_group_id, p_reason, p_receipt_line_id, p_transfer_line_id, p_sales_order_line_id,
      p_return_line_id, p_occurred_at, v_period_id, p_client_token, p_actor
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
create or replace function public.post_return(p_return_id uuid)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor   uuid := auth.uid();
  v_return  core.returns;
  v_line    record;
  v_group   uuid := gen_random_uuid();
  v_credit  numeric(14, 2) := 0;
  v_cn      uuid;
  v_batchok boolean;
  v_cost    numeric(18, 6);
begin
  select * into v_return from core.returns where id = p_return_id for update;
  if v_return.id is null then
    raise exception 'return not found' using errcode = 'no_data_found';
  end if;

  if v_return.status <> 'draft' then
    raise exception 'return % has already been %', v_return.return_no, v_return.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if not core.can_post(v_actor, public.current_user_role(), 'customer_return', v_return.location_id) then
    raise exception 'your role may not take returns at this location'
      using errcode = 'insufficient_privilege';
  end if;

  for v_line in
    select * from core.return_lines where return_id = p_return_id order by id
  loop
    v_credit := v_credit + v_line.line_total;

    -- Damaged goods are not stock. No movement; the credit note alone.
    if v_line.condition = 'resalable' then
      -- Only return to the original batch if it is still at this location.
      select exists (
        select 1 from core.stock_batches
         where id = v_line.source_batch_id and location_id = v_return.location_id
      ) into v_batchok;

      if v_batchok then
        -- Straight back where it came from, at the cost it left at, so it
        -- resumes its place in the FIFO queue instead of jumping the front.
        v_cost := null;
      else
        -- Goods handed back over the counter with no receipt are the normal
        -- case, not an error, so they still have to be valued. Best evidence
        -- first: what that sale actually recorded, then what the same goods on
        -- this shelf are worth, then the last price paid for them.
        select coalesce(
                 (select round(sl.cogs / nullif(sl.qty, 0), 6)
                    from core.sales_order_lines sl
                   where sl.id = v_line.source_sale_line_id),
                 (select round(sum(b.qty_remaining * b.unit_cost) / nullif(sum(b.qty_remaining), 0), 6)
                    from core.stock_batches b
                   where b.product_id = v_line.product_id
                     and b.location_id = v_return.location_id
                     and b.qty_remaining > 0),
                 (select p.last_cost from core.products p where p.id = v_line.product_id)
               )
          into v_cost;

        if v_cost is null then
          raise exception 'cannot value the return of product %', v_line.product_id
            using errcode = 'invalid_parameter_value',
                  hint = 'Link the return to its invoice, or receive this product once so a cost is known.';
        end if;
      end if;

      perform core.post_movement(
        p_type              => 'customer_return',
        p_product_id        => v_line.product_id,
        p_location_id       => v_return.location_id,
        p_qty               => v_line.qty,
        p_actor             => v_actor,
        p_occurred_at       => v_return.occurred_at,
        p_movement_group_id => v_group,
        p_return_line_id    => v_line.id,
        p_target_batch_id   => case when v_batchok then v_line.source_batch_id end,
        p_unit_cost         => v_cost,
        p_reason            => format('Return %s', v_return.return_no)
      );
    end if;
  end loop;

  if v_return.customer_id is not null and v_credit > 0 then
    insert into core.credit_notes (customer_id, return_id, amount, reason, issued_by)
    values (v_return.customer_id, p_return_id, v_credit, v_return.reason, v_actor)
    returning id into v_cn;

    insert into core.customer_ledger_entries
      (customer_id, entry_type, amount_signed, credit_note_id, occurred_at, created_by)
    values
      (v_return.customer_id, 'credit_note', -v_credit, v_cn, v_return.occurred_at, v_actor);
  end if;

  update core.returns
     set status = 'posted', posted_by = v_actor, posted_at = now()
   where id = p_return_id;

  return v_group;
end $$;

-- ---------------------------------------------------------------------------
-- A quick write-off, for stock that broke or expired on the shelf.
-- ---------------------------------------------------------------------------
create or replace function public.write_off_stock(
  p_product_id  uuid,
  p_location_id uuid,
  p_qty         numeric,
  p_reason      text,
  p_expired     boolean default false,
  p_client_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_type public.movement_type;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say what happened to this stock'
      using errcode = 'invalid_parameter_value',
            hint = 'An unexplained write-off is the first thing an auditor asks about.';
  end if;

  v_type := case when p_expired then 'expiry_writeoff' else 'damage' end;

  if not core.can_post(auth.uid(), public.current_user_role(), v_type, p_location_id) then
    raise exception 'your role may not write off stock at this location'
      using errcode = 'insufficient_privilege';
  end if;

  return core.post_movement(
    p_type         => v_type,
    p_product_id   => p_product_id,
    p_location_id  => p_location_id,
    p_qty          => p_qty,
    p_actor        => auth.uid(),
    p_reason       => btrim(p_reason),
    p_client_token => p_client_token
  );
end $$;

-- ---------------------------------------------------------------------------
drop view if exists public.v_returns;
create or replace view public.v_returns
  with (security_barrier = true, security_invoker = false) as
select r.id,
       r.return_no,
       r.customer_id,
       c.name as customer_name,
       r.order_id,
       o.invoice_no,
       r.location_id,
       l.code as location_code,
       r.status,
       r.reason,
       r.occurred_at,
       r.posted_at,
       (select coalesce(sum(rl.line_total), 0) from core.return_lines rl where rl.return_id = r.id)::text
         as credit_total,
       (select count(*) from core.return_lines rl where rl.return_id = r.id) as line_count
  from core.returns r
  join core.locations l          on l.id = r.location_id
  left join core.customers c     on c.id = r.customer_id
  left join core.sales_orders o  on o.id = r.order_id
 where public.can_access_location(r.location_id);

drop view if exists public.v_return_lines;
create or replace view public.v_return_lines
  with (security_barrier = true, security_invoker = false) as
select rl.id,
       rl.return_id,
       rl.product_id,
       p.sku,
       p.name as product_name,
       p.base_unit,
       rl.qty,
       rl.condition,
       rl.unit_price::text as unit_price,
       rl.line_total::text as line_total
  from core.return_lines rl
  join core.products p on p.id = rl.product_id
  join core.returns r  on r.id = rl.return_id
 where public.can_access_location(r.location_id);

grant select on public.v_returns, public.v_return_lines to authenticated;

revoke all on function public.create_return(uuid, uuid, uuid, text) from public;
revoke all on function public.set_return_line(uuid, uuid, numeric, text, numeric) from public;
revoke all on function public.post_return(uuid) from public;
revoke all on function public.write_off_stock(uuid, uuid, numeric, text, boolean, uuid) from public;

grant execute on function public.create_return(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.set_return_line(uuid, uuid, numeric, text, numeric) to authenticated;
grant execute on function public.post_return(uuid) to authenticated;
grant execute on function public.write_off_stock(uuid, uuid, numeric, text, boolean, uuid) to authenticated;

alter table core.returns enable row level security;
alter table core.return_lines enable row level security;
alter table core.credit_notes enable row level security;
