-- 09 · Transfers
--
-- Moving goods from the warehouse to the shop is the app's central flow, so
-- this lands in Phase 1 rather than with the later document types.
--
-- A transfer is two legs, not one move. Dispatch posts warehouse -> in_transit;
-- receipt posts in_transit -> shop. Between them the stock is somewhere real,
-- so company value does not dip when a van leaves and recover when it arrives.
-- A short-receipt leaves the difference parked in in_transit where the
-- valuation report keeps showing it until someone writes it off or explains it.

create sequence if not exists core.transfer_number_seq;

create or replace function core.next_transfer_no()
returns text
language sql
volatile
set search_path = core, public
as $$
  select 'TRF-' || lpad(nextval('core.transfer_number_seq')::text, 5, '0')
$$;

create table if not exists core.transfers (
  id               uuid primary key default gen_random_uuid(),
  transfer_no      text not null unique default core.next_transfer_no(),
  from_location_id uuid not null references core.locations(id) on delete restrict,
  to_location_id   uuid not null references core.locations(id) on delete restrict,
  status           text not null default 'draft'
                   check (status in ('draft', 'dispatched', 'received', 'cancelled')),
  dispatched_at    timestamptz,
  dispatched_by    uuid references core.app_users(id) on delete set null,
  received_at      timestamptz,
  received_by      uuid references core.app_users(id) on delete set null,
  notes            text,
  created_by       uuid references core.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint transfer_distinct_locations check (from_location_id <> to_location_id),
  constraint transfer_dispatch_consistently check ((dispatched_at is null) = (dispatched_by is null)),
  constraint transfer_receive_consistently check ((received_at is null) = (received_by is null)),
  -- Cannot be received before it was dispatched.
  constraint transfer_receipt_follows_dispatch
    check (received_at is null or (dispatched_at is not null and received_at >= dispatched_at))
);

create index if not exists idx_transfers_status on core.transfers (status, dispatched_at);
create index if not exists idx_transfers_from on core.transfers (from_location_id);
create index if not exists idx_transfers_to on core.transfers (to_location_id);

drop trigger if exists trg_transfers_touch on core.transfers;
create trigger trg_transfers_touch
  before update on core.transfers
  for each row execute function core.touch_updated_at();

create table if not exists core.transfer_lines (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references core.transfers(id) on delete cascade,
  product_id      uuid not null references core.products(id) on delete restrict,
  qty_requested   numeric(14, 3) not null check (qty_requested > 0),
  qty_dispatched  numeric(14, 3) not null default 0 check (qty_dispatched >= 0),
  qty_received    numeric(14, 3) not null default 0 check (qty_received >= 0),
  created_at      timestamptz not null default now(),

  unique (transfer_id, product_id),

  -- More cannot arrive than left. The reverse gap is legitimate and is exactly
  -- the residual that stays visible in in_transit.
  constraint transfer_line_received_le_dispatched check (qty_received <= qty_dispatched)
);

create index if not exists idx_transfer_lines_transfer on core.transfer_lines (transfer_id);
create index if not exists idx_transfer_lines_product on core.transfer_lines (product_id);

alter table core.transfers enable row level security;
alter table core.transfer_lines enable row level security;
