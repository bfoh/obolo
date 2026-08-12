-- 27 · Payments
--
-- A payment is money received from a customer. What it settles is recorded
-- separately, because the two are genuinely separate facts: someone can pay
-- GHS 500 against three invoices, or pay on account with nothing owed yet, and
-- both must be expressible without inventing an invoice to hang it on.
--
-- Nothing here is ever edited. A payment taken in error is reversed, which
-- appends a compensating entry and leaves the original visible. That is what
-- lets a statement be reconstructed, and it is the direct replacement for the
-- predecessor's delete-by-nearest-amount, which would eventually remove the
-- wrong payment.

create sequence if not exists core.payment_number_seq;

create or replace function core.next_payment_no()
returns text language sql volatile set search_path = core, public as $$
  select 'RCT-' || lpad(nextval('core.payment_number_seq')::text, 5, '0')
$$;

create table if not exists core.payments (
  id            uuid primary key default gen_random_uuid(),
  receipt_no    text not null unique default core.next_payment_no(),
  customer_id   uuid not null references core.customers(id) on delete restrict,
  amount        numeric(14, 2) not null check (amount <> 0),
  method        public.pay_method not null default 'cash',
  -- MoMo transaction id, cheque number, bank reference.
  reference     text,
  note          text,
  received_at   timestamptz not null default now(),
  received_by   uuid not null references core.app_users(id) on delete restrict,
  reverses_payment_id uuid unique references core.payments(id) on delete restrict,
  client_token  uuid,
  created_at    timestamptz not null default now()
);

create unique index if not exists idx_payments_client_token
  on core.payments (client_token) where client_token is not null;
create index if not exists idx_payments_customer on core.payments (customer_id, received_at desc);

drop trigger if exists trg_payments_append_only on core.payments;
create trigger trg_payments_append_only
  before update or delete on core.payments
  for each row execute function core.deny_mutation();

-- What each payment settles. A payment may be split across invoices, or left
-- partly unallocated as money on account.
create table if not exists core.payment_allocations (
  id         uuid primary key default gen_random_uuid(),
  payment_id uuid not null references core.payments(id) on delete restrict,
  order_id   uuid not null references core.sales_orders(id) on delete restrict,
  amount     numeric(14, 2) not null check (amount <> 0),
  created_at timestamptz not null default now(),
  unique (payment_id, order_id)
);

create index if not exists idx_payalloc_order on core.payment_allocations (order_id);

alter table core.customer_ledger_entries
  drop constraint if exists customer_ledger_entries_payment_id_fkey;
alter table core.customer_ledger_entries
  add constraint customer_ledger_entries_payment_id_fkey
  foreign key (payment_id) references core.payments(id) on delete restrict;

-- ---------------------------------------------------------------------------
create or replace function core.order_paid(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce(sum(amount), 0)
    from core.payment_allocations
   where order_id = p_order_id
$$;

create or replace function core.refresh_payment_status(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_total numeric(14, 2);
  v_paid  numeric(14, 2);
begin
  select total into v_total from core.sales_orders where id = p_order_id;
  if v_total is null then return; end if;

  v_paid := core.order_paid(p_order_id);

  update core.sales_orders
     set payment_status = case
           when v_paid >= v_total then 'paid'
           when v_paid > 0        then 'partial'
           else 'unpaid'
         end
   where id = p_order_id;
end $$;

-- ---------------------------------------------------------------------------
-- record_payment
--
-- Allocates against the oldest unpaid invoice first, which is what a trader
-- does on paper and what makes a statement read sensibly. Anything left over
-- stays unallocated as money on account rather than being refused.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_customer_id  uuid,
  p_amount       numeric,
  p_method       public.pay_method default 'cash',
  p_reference    text default null,
  p_order_id     uuid default null,
  p_note         text default null,
  p_client_token uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor     uuid := auth.uid();
  v_payment   uuid;
  v_remaining numeric(14, 2);
  v_apply     numeric(14, 2);
  v_owing     numeric(14, 2);
  r           record;
begin
  if public.current_user_role() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'a payment must be a positive amount'
      using errcode = 'invalid_parameter_value';
  end if;

  if p_client_token is not null then
    select id into v_payment from core.payments where client_token = p_client_token;
    if v_payment is not null then
      return v_payment;
    end if;
  end if;

  insert into core.payments
    (customer_id, amount, method, reference, note, received_by, client_token)
  values
    (p_customer_id, p_amount, p_method, p_reference, p_note, v_actor, p_client_token)
  returning id into v_payment;

  insert into core.customer_ledger_entries
    (customer_id, entry_type, amount_signed, payment_id, created_by)
  values
    (p_customer_id, 'payment', -p_amount, v_payment, v_actor);

  v_remaining := p_amount;

  -- A payment made against a named invoice settles that one first.
  if p_order_id is not null then
    select total - core.order_paid(id) into v_owing
      from core.sales_orders where id = p_order_id;

    if v_owing > 0 then
      v_apply := least(v_owing, v_remaining);
      insert into core.payment_allocations (payment_id, order_id, amount)
      values (v_payment, p_order_id, v_apply)
      on conflict (payment_id, order_id) do update set amount = core.payment_allocations.amount + excluded.amount;
      v_remaining := v_remaining - v_apply;
      perform core.refresh_payment_status(p_order_id);
    end if;
  end if;

  -- Then oldest first.
  for r in
    select id, total - core.order_paid(id) as owing
      from core.sales_orders
     where customer_id = p_customer_id
       and status = 'fulfilled'
       and payment_status <> 'paid'
       and (p_order_id is null or id <> p_order_id)
     order by occurred_at, order_no
  loop
    exit when v_remaining <= 0;
    if r.owing <= 0 then continue; end if;

    v_apply := least(r.owing, v_remaining);
    insert into core.payment_allocations (payment_id, order_id, amount)
    values (v_payment, r.id, v_apply)
    on conflict (payment_id, order_id) do update set amount = core.payment_allocations.amount + excluded.amount;

    v_remaining := v_remaining - v_apply;
    perform core.refresh_payment_status(r.id);
  end loop;

  -- v_remaining above zero is money on account. It reduces the balance through
  -- the ledger entry already written, and will settle the next invoice raised.
  return v_payment;
end $$;

-- ---------------------------------------------------------------------------
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_actor    uuid := auth.uid();
  v_original core.payments;
  v_reversal uuid;
  r          record;
begin
  perform core.require_owner();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'say why this payment is being reversed'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_original from core.payments where id = p_payment_id;
  if v_original.id is null then
    raise exception 'payment not found' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from core.payments where reverses_payment_id = p_payment_id) then
    raise exception 'that payment has already been reversed'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  insert into core.payments
    (customer_id, amount, method, reference, note, received_by, reverses_payment_id)
  values
    (v_original.customer_id, -v_original.amount, v_original.method,
     v_original.reference, p_reason, v_actor, p_payment_id)
  returning id into v_reversal;

  insert into core.customer_ledger_entries
    (customer_id, entry_type, amount_signed, payment_id, reason, created_by)
  values
    (v_original.customer_id, 'payment', v_original.amount, v_reversal, p_reason, v_actor);

  -- Undo the allocations so the invoices it settled go back to owing.
  for r in select order_id, amount from core.payment_allocations where payment_id = p_payment_id
  loop
    insert into core.payment_allocations (payment_id, order_id, amount)
    values (v_reversal, r.order_id, -r.amount);
    perform core.refresh_payment_status(r.order_id);
  end loop;

  return v_reversal;
end $$;

revoke all on function public.record_payment(uuid, numeric, public.pay_method, text, uuid, text, uuid) from public;
revoke all on function public.reverse_payment(uuid, text) from public;
grant execute on function public.record_payment(uuid, numeric, public.pay_method, text, uuid, text, uuid) to authenticated;
grant execute on function public.reverse_payment(uuid, text) to authenticated;

alter table core.payments enable row level security;
alter table core.payment_allocations enable row level security;
