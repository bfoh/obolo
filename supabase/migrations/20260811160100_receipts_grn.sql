-- 08 · Goods received notes
--
-- A receipt may reference a purchase order or stand alone -- buying off a
-- passing truck is normal for a Ghanaian wholesaler and must not be unrecordable.

create sequence if not exists core.grn_number_seq;

create or replace function core.next_grn_no()
returns text
language sql
volatile
set search_path = core, public
as $$
  select 'GRN-' || lpad(nextval('core.grn_number_seq')::text, 5, '0')
$$;

create table if not exists core.receipts (
  id            uuid primary key default gen_random_uuid(),
  grn_no        text not null unique default core.next_grn_no(),
  po_id         uuid references core.purchase_orders(id) on delete restrict,
  supplier_id   uuid references core.suppliers(id) on delete restrict,
  location_id   uuid not null references core.locations(id) on delete restrict,
  status        text not null default 'draft' check (status in ('draft', 'posted', 'reversed')),
  waybill_no    text,
  received_at   timestamptz not null default now(),

  -- Charges that arrive on the whole delivery and are spread across its lines
  -- at post time. Cost columns.
  freight_total numeric(18, 6) not null default 0 check (freight_total >= 0),
  duty_total    numeric(18, 6) not null default 0 check (duty_total >= 0),
  other_total   numeric(18, 6) not null default 0 check (other_total >= 0),

  notes         text,
  received_by   uuid references core.app_users(id) on delete set null,
  posted_by     uuid references core.app_users(id) on delete set null,
  posted_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint receipt_posted_consistently check ((posted_at is null) = (posted_by is null)),
  constraint receipt_posted_has_timestamp check (status <> 'posted' or posted_at is not null)
);

create index if not exists idx_receipts_status on core.receipts (status, received_at);
create index if not exists idx_receipts_po on core.receipts (po_id);
create index if not exists idx_receipts_location on core.receipts (location_id);

drop trigger if exists trg_receipts_touch on core.receipts;
create trigger trg_receipts_touch
  before update on core.receipts
  for each row execute function core.touch_updated_at();

create table if not exists core.receipt_lines (
  id                 uuid primary key default gen_random_uuid(),
  receipt_id         uuid not null references core.receipts(id) on delete cascade,
  po_line_id         uuid references core.purchase_order_lines(id) on delete restrict,
  product_id         uuid not null references core.products(id) on delete restrict,
  qty_received       numeric(14, 3) not null check (qty_received > 0),

  -- What the supplier invoiced, before landing charges. Cost column.
  invoice_unit_cost  numeric(18, 6) not null check (invoice_unit_cost >= 0),
  -- This line's share of the delivery's freight/duty/other, written by
  -- post_receipt(). Cost column.
  allocated_charges  numeric(18, 6) not null default 0 check (allocated_charges >= 0),

  -- LANDED cost is what a batch is valued at, not invoice cost. For a Ghanaian
  -- wholesaler, clearing, duty and haulage are a material share of true cost;
  -- valuing stock at invoice cost understates inventory by 10-25% and inflates
  -- every margin computed against it.
  landed_unit_cost   numeric(18, 6)
    generated always as (
      invoice_unit_cost + case when qty_received > 0 then allocated_charges / qty_received else 0 end
    ) stored,

  expiry_date        date,
  lot_code           text,
  -- Set when the line posts and its batch is created.
  batch_id           uuid,
  created_at         timestamptz not null default now()
);

create index if not exists idx_receipt_lines_receipt on core.receipt_lines (receipt_id);
create index if not exists idx_receipt_lines_product on core.receipt_lines (product_id);
create index if not exists idx_receipt_lines_po_line on core.receipt_lines (po_line_id);

alter table core.receipts enable row level security;
alter table core.receipt_lines enable row level security;

comment on column core.receipt_lines.landed_unit_cost is
  'Invoice cost plus this line''s share of delivery charges. This is what the batch is valued at.';
