-- 28 · Building a sale, and the read surface for trade
--
-- Access follows the counter each role works. Warehouse staff sell wholesale on
-- credit, so they need the customer ledger. Shop staff take cash at the till and
-- have no business seeing who owes what.

create or replace function public.create_customer(
  p_code               text,
  p_name               text,
  p_phone              text default null,
  p_email              text default null,
  p_kind               text default 'wholesale',
  p_credit_limit       numeric default 0,
  p_payment_terms_days int default 0
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
    raise exception 'your role may not manage customers'
      using errcode = 'insufficient_privilege';
  end if;

  -- A credit limit is an owner's decision: it is how much of the company's
  -- money a staff member would be able to hand out on trust.
  if coalesce(p_credit_limit, 0) > 0 and not public.is_owner() then
    raise exception 'only an owner can give a customer credit'
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.customers
    (code, name, phone, email, kind, credit_limit, payment_terms_days, created_by)
  values
    (btrim(p_code), btrim(p_name), p_phone, p_email, p_kind,
     coalesce(p_credit_limit, 0), coalesce(p_payment_terms_days, 0), auth.uid())
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.update_customer(
  p_customer_id        uuid,
  p_name               text default null,
  p_phone              text default null,
  p_email              text default null,
  p_address            text default null,
  p_credit_limit       numeric default null,
  p_payment_terms_days int default null,
  p_is_active          boolean default null
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  if public.current_user_role() not in ('owner', 'warehouse_staff') then
    raise exception 'your role may not manage customers'
      using errcode = 'insufficient_privilege';
  end if;

  if p_credit_limit is not null and not public.is_owner() then
    raise exception 'only an owner can change a credit limit'
      using errcode = 'insufficient_privilege';
  end if;

  update core.customers
     set name               = coalesce(nullif(btrim(p_name), ''), name),
         phone              = coalesce(p_phone, phone),
         email              = coalesce(p_email, email),
         address            = coalesce(p_address, address),
         credit_limit       = coalesce(p_credit_limit, credit_limit),
         payment_terms_days = coalesce(p_payment_terms_days, payment_terms_days),
         is_active          = coalesce(p_is_active, is_active)
   where id = p_customer_id;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.create_sale(
  p_channel     public.sale_channel,
  p_location_id uuid default null,
  p_customer_id uuid default null,
  p_due_date    date default null,
  p_notes       text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor    uuid := auth.uid();
  v_role     public.user_role := public.current_user_role();
  v_type     public.movement_type;
  v_location uuid;
  v_id       uuid;
begin
  v_type := case p_channel
              when 'wholesale' then 'wholesale_sale'::public.movement_type
              else 'retail_sale'::public.movement_type
            end;

  v_location := coalesce(
    p_location_id,
    (select id from core.locations
      -- Cast explicitly: `kind` is an enum and the CASE yields text, which
      -- Postgres will not compare implicitly.
      where kind = (case p_channel when 'wholesale' then 'warehouse' else 'retail' end)::public.location_kind
        and is_active
      order by code limit 1)
  );

  if v_location is null then
    raise exception 'no location to sell from' using errcode = 'no_data_found';
  end if;

  if not core.can_post(v_actor, v_role, v_type, v_location) then
    raise exception 'your role may not sell from this location'
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.sales_orders (channel, location_id, customer_id, due_date, notes, created_by)
  values (p_channel, v_location, p_customer_id, p_due_date, p_notes, v_actor)
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.set_sale_line(
  p_order_id   uuid,
  p_product_id uuid,
  p_qty        numeric,
  p_unit_price numeric default null,
  p_discount   numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_order core.sales_orders;
  v_price numeric(14, 2);
  v_id    uuid;
begin
  select * into v_order from core.sales_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'sale not found' using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'draft' then
    raise exception 'this sale has already been %; it can no longer be edited', v_order.status
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_qty is null or p_qty <= 0 then
    delete from core.sales_order_lines where order_id = p_order_id and product_id = p_product_id;
    return null;
  end if;

  -- Default to the list price for the channel, so the till does not require
  -- typing a price for every line.
  v_price := coalesce(
    p_unit_price,
    case v_order.channel
      when 'wholesale' then (select wholesale_price from core.products where id = p_product_id)
      else (select retail_price from core.products where id = p_product_id)
    end
  );

  if v_price is null then
    raise exception 'this product has no price set for % sales', v_order.channel
      using errcode = 'invalid_parameter_value',
            hint = 'Set the price on the product, or type one on the line.';
  end if;

  insert into core.sales_order_lines (order_id, product_id, qty, unit_price, discount)
  values (p_order_id, p_product_id, p_qty, v_price, coalesce(p_discount, 0))
  on conflict (order_id, product_id) do update
     set qty = excluded.qty, unit_price = excluded.unit_price, discount = excluded.discount
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.cancel_sale(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_status text;
begin
  select status into v_status from core.sales_orders where id = p_order_id;

  if v_status is distinct from 'draft' then
    raise exception 'only a draft sale can be cancelled; this one is %', coalesce(v_status, 'missing')
      using errcode = 'object_not_in_prerequisite_state',
            hint = 'A fulfilled sale is undone by reversing its movements.';
  end if;

  update core.sales_orders set status = 'cancelled' where id = p_order_id;
end $$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
drop view if exists public.v_customers;
create or replace view public.v_customers
  with (security_barrier = true, security_invoker = false) as
select c.id,
       c.code,
       c.name,
       c.phone,
       c.email,
       c.address,
       c.kind,
       c.credit_limit::text       as credit_limit,
       core.customer_balance(c.id)::text as balance,
       greatest(c.credit_limit - core.customer_balance(c.id), 0)::text as credit_available,
       c.payment_terms_days,
       c.is_active,
       c.created_at
  from core.customers c
 where public.current_user_role() in ('owner', 'warehouse_staff');

drop view if exists public.v_customer_ledger;
create or replace view public.v_customer_ledger
  with (security_barrier = true, security_invoker = false) as
select e.id,
       e.seq,
       e.customer_id,
       e.entry_type,
       e.amount_signed::text as amount,
       e.order_id,
       o.invoice_no,
       e.payment_id,
       p.receipt_no,
       e.reason,
       e.occurred_at,
       u.full_name as created_by_name
  from core.customer_ledger_entries e
  left join core.sales_orders o on o.id = e.order_id
  left join core.payments p     on p.id = e.payment_id
  left join core.app_users u    on u.id = e.created_by
 where public.current_user_role() in ('owner', 'warehouse_staff');

drop view if exists public.v_sales_orders;
create or replace view public.v_sales_orders
  with (security_barrier = true, security_invoker = false) as
select o.id,
       o.order_no,
       o.invoice_no,
       o.channel,
       o.location_id,
       l.code as location_code,
       o.customer_id,
       c.name as customer_name,
       o.status,
       o.payment_status,
       o.subtotal::text as subtotal,
       o.discount::text as discount,
       o.total::text    as total,
       core.order_paid(o.id)::text as paid,
       (o.total - core.order_paid(o.id))::text as owing,
       case when public.is_owner() then o.total_cogs::text   end as total_cogs,
       case when public.is_owner() then o.gross_profit::text end as gross_profit,
       o.due_date,
       o.occurred_at,
       o.invoiced_at,
       o.notes,
       (select count(*) from core.sales_order_lines sl where sl.order_id = o.id) as line_count
  from core.sales_orders o
  join core.locations l      on l.id = o.location_id
  left join core.customers c on c.id = o.customer_id
 where public.can_access_location(o.location_id);

drop view if exists public.v_sales_order_lines;
create or replace view public.v_sales_order_lines
  with (security_barrier = true, security_invoker = false) as
select sl.id,
       sl.order_id,
       sl.product_id,
       p.sku,
       p.name as product_name,
       p.base_unit,
       sl.qty,
       sl.unit_price::text as unit_price,
       sl.discount::text   as discount,
       sl.line_total::text as line_total,
       case when public.is_owner() then sl.cogs::text end as cogs,
       case when public.is_owner() then (sl.line_total - sl.cogs)::text end as margin
  from core.sales_order_lines sl
  join core.products p     on p.id = sl.product_id
  join core.sales_orders o on o.id = sl.order_id
 where public.can_access_location(o.location_id);

drop view if exists public.v_payments;
create or replace view public.v_payments
  with (security_barrier = true, security_invoker = false) as
select p.id,
       p.receipt_no,
       p.customer_id,
       c.name as customer_name,
       p.amount::text as amount,
       p.method,
       p.reference,
       p.note,
       p.received_at,
       p.reverses_payment_id,
       exists (select 1 from core.payments r where r.reverses_payment_id = p.id) as is_reversed,
       u.full_name as received_by_name
  from core.payments p
  join core.customers c      on c.id = p.customer_id
  left join core.app_users u on u.id = p.received_by
 where public.current_user_role() in ('owner', 'warehouse_staff');

grant select on
  public.v_customers,
  public.v_customer_ledger,
  public.v_sales_orders,
  public.v_sales_order_lines,
  public.v_payments
to authenticated;

revoke all on function public.create_customer(text, text, text, text, text, numeric, int) from public;
revoke all on function public.update_customer(uuid, text, text, text, text, numeric, int, boolean) from public;
revoke all on function public.create_sale(public.sale_channel, uuid, uuid, date, text) from public;
revoke all on function public.set_sale_line(uuid, uuid, numeric, numeric, numeric) from public;
revoke all on function public.cancel_sale(uuid) from public;
revoke all on function public.post_sale(uuid, numeric, public.pay_method, uuid) from public;

grant execute on function public.create_customer(text, text, text, text, text, numeric, int) to authenticated;
grant execute on function public.update_customer(uuid, text, text, text, text, numeric, int, boolean) to authenticated;
grant execute on function public.create_sale(public.sale_channel, uuid, uuid, date, text) to authenticated;
grant execute on function public.set_sale_line(uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.cancel_sale(uuid) to authenticated;
grant execute on function public.post_sale(uuid, numeric, public.pay_method, uuid) to authenticated;
