-- 07 · Suppliers and purchase orders

create table if not exists core.suppliers (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null check (length(btrim(name)) > 0),
  phone               text,
  email               text,
  address             text,
  tin                 text,
  payment_terms_days  int not null default 0 check (payment_terms_days >= 0),
  currency            char(3) not null default 'GHS',
  is_active           boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_suppliers_active on core.suppliers (is_active, name);

drop trigger if exists trg_suppliers_touch on core.suppliers;
create trigger trg_suppliers_touch
  before update on core.suppliers
  for each row execute function core.touch_updated_at();

-- Document numbering. A sequence rather than count(*)+1, which races and
-- reuses numbers after a delete -- neither acceptable on a document an auditor
-- will ask to see.
create sequence if not exists core.po_number_seq;

create or replace function core.next_po_no()
returns text
language sql
volatile
set search_path = core, public
as $$
  select 'PO-' || lpad(nextval('core.po_number_seq')::text, 5, '0')
$$;

create table if not exists core.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  po_no         text not null unique default core.next_po_no(),
  supplier_id   uuid not null references core.suppliers(id) on delete restrict,
  location_id   uuid not null references core.locations(id) on delete restrict,
  status        text not null default 'draft'
                check (status in ('draft', 'sent', 'partially_received', 'received', 'cancelled', 'closed')),
  ordered_at    timestamptz,
  expected_at   timestamptz,
  currency      char(3) not null default 'GHS',

  -- Cost columns.
  subtotal      numeric(18, 6) not null default 0 check (subtotal >= 0),
  freight       numeric(18, 6) not null default 0 check (freight >= 0),
  duty          numeric(18, 6) not null default 0 check (duty >= 0),
  other_charges numeric(18, 6) not null default 0 check (other_charges >= 0),
  total         numeric(18, 6) generated always as (subtotal + freight + duty + other_charges) stored,

  notes         text,
  created_by    uuid references core.app_users(id) on delete set null,
  approved_by   uuid references core.app_users(id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint po_approved_consistently check ((approved_at is null) = (approved_by is null))
);

create index if not exists idx_po_status on core.purchase_orders (status, expected_at);
create index if not exists idx_po_supplier on core.purchase_orders (supplier_id);

drop trigger if exists trg_po_touch on core.purchase_orders;
create trigger trg_po_touch
  before update on core.purchase_orders
  for each row execute function core.touch_updated_at();

create table if not exists core.purchase_order_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references core.purchase_orders(id) on delete cascade,
  product_id   uuid not null references core.products(id) on delete restrict,
  qty_ordered  numeric(14, 3) not null check (qty_ordered > 0),
  -- Cache maintained by post_receipt(), not by the client.
  qty_received numeric(14, 3) not null default 0 check (qty_received >= 0),
  unit_cost    numeric(18, 6) not null check (unit_cost >= 0),
  line_total   numeric(18, 6) generated always as (qty_ordered * unit_cost) stored,

  unique (po_id, product_id),

  -- Deliveries overshoot slightly; anything past 5% is a different order and
  -- needs the PO amended rather than silently absorbed.
  constraint po_line_over_receipt_tolerance
    check (qty_received <= qty_ordered * 1.05)
);

create index if not exists idx_po_lines_po on core.purchase_order_lines (po_id);
create index if not exists idx_po_lines_product on core.purchase_order_lines (product_id);

alter table core.suppliers enable row level security;
alter table core.purchase_orders enable row level security;
alter table core.purchase_order_lines enable row level security;
