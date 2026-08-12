-- 25 · Customers and the receivables ledger
--
-- The same discipline as the stock ledger, applied to money owed: entries are
-- append-only and signed, and a balance is a SUM rather than a column somebody
-- keeps up to date.
--
-- There is deliberately no `customers.balance`. A cached balance is a second
-- source of truth that drifts the first time a write fails halfway, and once it
-- has drifted nothing can tell you which number was right. The app OBOLO
-- replaces mutated a paid-amount column in place and, worse, deleted payments
-- by searching for a row whose amount was within 0.001 of the one being
-- removed, newest first -- a heuristic that eventually deletes the wrong
-- payment. Neither problem can be expressed against an append-only ledger.

create table if not exists core.customers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null check (length(btrim(name)) > 0),
  phone              text,
  email              text,
  address            text,
  tin                text,
  kind               text not null default 'wholesale'
                     check (kind in ('wholesale', 'retail', 'walk_in')),
  -- Zero means no credit: they pay at the counter.
  credit_limit       numeric(14, 2) not null default 0 check (credit_limit >= 0),
  payment_terms_days int not null default 0 check (payment_terms_days >= 0),
  is_active          boolean not null default true,
  notes              text,
  created_by         uuid references core.app_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_customers_active on core.customers (is_active, name);
create index if not exists idx_customers_phone on core.customers (phone) where phone is not null;
create index if not exists idx_customers_name_trgm
  on core.customers using gin (name extensions.gin_trgm_ops);

drop trigger if exists trg_customers_touch on core.customers;
create trigger trg_customers_touch
  before update on core.customers
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The ledger
--
-- Positive increases what the customer owes (an invoice); negative reduces it
-- (a payment, a credit note, a write-off). Balance = sum(amount_signed).
-- ---------------------------------------------------------------------------
create table if not exists core.customer_ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  seq            bigint generated always as identity,
  customer_id    uuid not null references core.customers(id) on delete restrict,
  entry_type     text not null
                 check (entry_type in ('invoice', 'payment', 'credit_note', 'adjustment', 'write_off')),
  amount_signed  numeric(14, 2) not null check (amount_signed <> 0),

  -- Typed source references, exactly as the stock ledger does it. The FKs are
  -- added by the migrations that create those tables.
  order_id       uuid,
  payment_id     uuid,
  credit_note_id uuid,

  occurred_at    timestamptz not null default now(),
  reason         text,
  created_by     uuid not null references core.app_users(id) on delete restrict,
  created_at     timestamptz not null default now(),

  constraint cle_one_source check (num_nonnulls(order_id, payment_id, credit_note_id) <= 1),
  -- An adjustment or write-off moves money without a document behind it, so it
  -- must say why.
  constraint cle_manual_needs_reason
    check (entry_type not in ('adjustment', 'write_off') or reason is not null)
);

create index if not exists idx_cle_customer on core.customer_ledger_entries (customer_id, occurred_at);
create index if not exists idx_cle_order on core.customer_ledger_entries (order_id);
create index if not exists idx_cle_payment on core.customer_ledger_entries (payment_id);

drop trigger if exists trg_cle_append_only on core.customer_ledger_entries;
create trigger trg_cle_append_only
  before update or delete on core.customer_ledger_entries
  for each row execute function core.deny_mutation();

-- ---------------------------------------------------------------------------
create or replace function core.customer_balance(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce(sum(amount_signed), 0)
    from core.customer_ledger_entries
   where customer_id = p_customer_id
$$;

/**
 * Whether an amount can go on credit, and why not if it cannot.
 * Returns null when the sale is fine.
 */
create or replace function core.credit_refusal(p_customer_id uuid, p_amount numeric)
returns text
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_limit   numeric(14, 2);
  v_balance numeric(14, 2);
  v_name    text;
begin
  select credit_limit, name into v_limit, v_name
    from core.customers where id = p_customer_id and is_active;

  if v_limit is null then
    return 'that customer is not on file';
  end if;

  v_balance := core.customer_balance(p_customer_id);

  if v_limit = 0 then
    return format('%s has no credit limit set', v_name);
  end if;

  if v_balance + p_amount > v_limit then
    return format('%s would owe %s against a limit of %s',
                  v_name, round(v_balance + p_amount, 2), v_limit);
  end if;

  return null;
end $$;

alter table core.customers enable row level security;
alter table core.customer_ledger_entries enable row level security;

comment on table core.customer_ledger_entries is
  'Append-only. A customer balance is sum(amount_signed), never a stored column.';
