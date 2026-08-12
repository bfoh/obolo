-- 26 · Sales
--
-- The margin on a sale is not price minus some notion of average cost -- it is
-- price minus what the units actually cost, which is only knowable once FIFO
-- has chosen the batches. post_sale therefore posts the stock movement first
-- and reads the cost back off the allocations it produced. The line's `cogs` is
-- a fact about which goods left the building, not an estimate.

create sequence if not exists core.order_number_seq;
create sequence if not exists core.invoice_number_seq;

create or replace function core.next_order_no()
returns text language sql volatile set search_path = core, public as $$
  select 'SO-' || lpad(nextval('core.order_number_seq')::text, 5, '0')
$$;

create or replace function core.next_invoice_no()
returns text language sql volatile set search_path = core, public as $$
  select 'INV-' || lpad(nextval('core.invoice_number_seq')::text, 5, '0')
$$;

create table if not exists core.sales_orders (
  id             uuid primary key default gen_random_uuid(),
  order_no       text not null unique default core.next_order_no(),
  channel        public.sale_channel not null,
  location_id    uuid not null references core.locations(id) on delete restrict,
  customer_id    uuid references core.customers(id) on delete restrict,

  status         text not null default 'draft'
                 check (status in ('draft', 'fulfilled', 'cancelled')),
  payment_status text not null default 'unpaid'
                 check (payment_status in ('unpaid', 'partial', 'paid')),

  subtotal       numeric(14, 2) not null default 0,
  discount       numeric(14, 2) not null default 0 check (discount >= 0),
  total          numeric(14, 2) not null default 0,

  -- Cost columns, written by post_sale from the actual draws.
  total_cogs     numeric(18, 6),
  gross_profit   numeric(18, 6),

  invoice_no     text unique,
  invoiced_at    timestamptz,
  due_date       date,

  occurred_at    timestamptz not null default now(),
  notes          text,
  created_by     uuid references core.app_users(id) on delete set null,
  fulfilled_by   uuid references core.app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Wholesale always goes to a named customer; only the shop counter serves
  -- someone who never gives a name.
  constraint order_wholesale_needs_customer
    check (channel = 'retail' or customer_id is not null),
  -- Credit requires knowing who owes it. There is no anonymous credit.
  constraint order_credit_needs_customer
    check (due_date is null or customer_id is not null)
);

create index if not exists idx_orders_status on core.sales_orders (status, occurred_at desc);
create index if not exists idx_orders_customer on core.sales_orders (customer_id, occurred_at desc);
create index if not exists idx_orders_unpaid on core.sales_orders (payment_status)
  where payment_status <> 'paid';

drop trigger if exists trg_orders_touch on core.sales_orders;
create trigger trg_orders_touch
  before update on core.sales_orders
  for each row execute function core.touch_updated_at();

create table if not exists core.sales_order_lines (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references core.sales_orders(id) on delete cascade,
  product_id        uuid not null references core.products(id) on delete restrict,
  qty               numeric(14, 3) not null check (qty > 0),
  unit_price        numeric(14, 2) not null check (unit_price >= 0),
  discount          numeric(14, 2) not null default 0 check (discount >= 0),
  line_total        numeric(14, 2) generated always as (qty * unit_price - discount) stored,
  -- Cost column. Null until posted, then the real cost of the units that left.
  cogs              numeric(18, 6),
  movement_group_id uuid,
  created_at        timestamptz not null default now(),

  unique (order_id, product_id)
);

create index if not exists idx_order_lines_order on core.sales_order_lines (order_id);
create index if not exists idx_order_lines_product on core.sales_order_lines (product_id);

-- Link the stock ledger to the sale that caused the movement, and widen the
-- one-source rule now that another kind of source document exists.
alter table core.stock_movements
  add column if not exists sales_order_line_id uuid references core.sales_order_lines(id) on delete restrict;

create index if not exists idx_mv_order_line on core.stock_movements (sales_order_line_id);

alter table core.stock_movements drop constraint if exists mv_one_source;
alter table core.stock_movements add constraint mv_one_source
  check (num_nonnulls(receipt_line_id, transfer_line_id, sales_order_line_id) <= 1);

alter table core.customer_ledger_entries
  drop constraint if exists customer_ledger_entries_order_id_fkey;
alter table core.customer_ledger_entries
  add constraint customer_ledger_entries_order_id_fkey
  foreign key (order_id) references core.sales_orders(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- post_movement gains a sales-order-line link.
--
-- It has to be a parameter rather than something stamped on afterwards: the
-- ledger is append-only, so there is no UPDATE available to attach the
-- reference once the row exists. Dropped and recreated because adding a
-- parameter creates a second overload rather than replacing the function, and
-- two candidates with defaulted arguments make every call ambiguous.
-- ---------------------------------------------------------------------------
drop function if exists core.post_movement(
  public.movement_type, uuid, uuid, numeric, uuid, timestamptz, numeric, numeric,
  uuid, text, uuid, uuid, uuid, text, date, uuid, timestamptz, uuid, uuid
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
  p_sales_order_line_id uuid default null
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
    select id into v_movement_id
      from core.stock_movements
     where client_token = p_client_token;
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
      occurred_at, period_id, client_token, created_by
    ) values (
      p_type, p_product_id, p_location_id, p_qty, v_value, p_unit_price,
      v_group_id, p_reason, p_receipt_line_id, p_transfer_line_id, p_sales_order_line_id,
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
      occurred_at, period_id, client_token, created_by
    ) values (
      p_type, p_product_id, p_location_id, -p_qty, -v_value, p_unit_price,
      v_group_id, p_reason, p_receipt_line_id, p_transfer_line_id, p_sales_order_line_id,
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
-- post_sale
--
-- One transaction: stock leaves, cost is captured, the invoice is numbered, and
-- the customer's ledger is written. Splitting any of that apart would allow a
-- sale whose stock moved but whose money never appeared.
-- ---------------------------------------------------------------------------
create or replace function public.post_sale(
  p_order_id     uuid,
  p_paid_now     numeric default 0,
  p_pay_method   public.pay_method default 'cash',
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
  v_order    core.sales_orders;
  v_type     public.movement_type;
  v_group    uuid := gen_random_uuid();
  v_line     record;
  v_movement uuid;
  v_cogs     numeric(18, 6);
  v_subtotal numeric(14, 2) := 0;
  v_total    numeric(14, 2);
  v_totcogs  numeric(18, 6) := 0;
  v_owing    numeric(14, 2);
  v_refusal  text;
  v_invoice  text;
begin
  select * into v_order from core.sales_orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'sale not found' using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'draft' then
    raise exception 'sale % has already been %', v_order.order_no, v_order.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  v_type := case v_order.channel
              when 'wholesale' then 'wholesale_sale'::public.movement_type
              else 'retail_sale'::public.movement_type
            end;

  if not core.can_post(v_actor, v_role, v_type, v_order.location_id) then
    raise exception 'your role may not sell from this location'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from core.sales_order_lines where order_id = p_order_id) then
    raise exception 'sale % has no lines', v_order.order_no
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(sum(line_total), 0) into v_subtotal
    from core.sales_order_lines where order_id = p_order_id;

  v_total := v_subtotal - v_order.discount;
  if v_total < 0 then
    raise exception 'the discount is larger than the sale'
      using errcode = 'invalid_parameter_value';
  end if;

  v_owing := v_total - coalesce(p_paid_now, 0);

  -- Check credit BEFORE any stock moves, so a refused sale leaves nothing
  -- behind to unwind.
  if v_owing > 0 then
    if v_order.customer_id is null then
      raise exception 'a sale left partly unpaid needs a named customer'
        using errcode = 'invalid_parameter_value';
    end if;

    v_refusal := core.credit_refusal(v_order.customer_id, v_owing);
    if v_refusal is not null then
      raise exception 'credit refused: %', v_refusal
        using errcode = 'check_violation',
              hint = 'Take payment now, or raise their credit limit.';
    end if;
  end if;

  for v_line in
    select * from core.sales_order_lines where order_id = p_order_id order by id
  loop
    v_movement := core.post_movement(
      p_type               => v_type,
      p_product_id         => v_line.product_id,
      p_location_id        => v_order.location_id,
      p_qty                => v_line.qty,
      p_actor              => v_actor,
      p_occurred_at        => v_order.occurred_at,
      p_unit_price         => v_line.unit_price,
      p_movement_group_id  => v_group,
      p_sales_order_line_id => v_line.id
    );

    -- The cost of this sale is whatever FIFO actually drew, not an average.
    select -coalesce(sum(value_delta), 0) into v_cogs
      from core.movement_batch_allocations where movement_id = v_movement;

    update core.sales_order_lines
       set cogs = v_cogs, movement_group_id = v_group
     where id = v_line.id;

    v_totcogs := v_totcogs + v_cogs;
  end loop;

  v_invoice := core.next_invoice_no();

  update core.sales_orders
     set status         = 'fulfilled',
         subtotal       = v_subtotal,
         total          = v_total,
         total_cogs     = v_totcogs,
         gross_profit   = v_total - v_totcogs,
         invoice_no     = v_invoice,
         invoiced_at    = now(),
         payment_status = case
                            when v_owing <= 0 then 'paid'
                            when coalesce(p_paid_now, 0) > 0 then 'partial'
                            else 'unpaid'
                          end,
         fulfilled_by   = v_actor
   where id = p_order_id;

  -- A named customer gets a full statement: the invoice always appears, and
  -- anything paid at the counter appears against it. A walk-in who paid cash
  -- has no ledger at all, which is correct -- they owe nothing and never did.
  if v_order.customer_id is not null then
    insert into core.customer_ledger_entries
      (customer_id, entry_type, amount_signed, order_id, occurred_at, created_by)
    values
      (v_order.customer_id, 'invoice', v_total, p_order_id, v_order.occurred_at, v_actor);

    if coalesce(p_paid_now, 0) > 0 then
      perform public.record_payment(
        p_customer_id => v_order.customer_id,
        p_amount      => p_paid_now,
        p_method      => p_pay_method,
        p_order_id    => p_order_id,
        p_note        => 'Paid at the time of sale'
      );
    end if;
  end if;

  return v_group;
end $$;

alter table core.sales_orders enable row level security;
alter table core.sales_order_lines enable row level security;

comment on column core.sales_order_lines.cogs is
  'Actual cost of the units that left, read back from the FIFO allocations. Cost column.';
