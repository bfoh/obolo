-- 05 · Product catalogue
--
-- Precision policy, applied from here on:
--   costs and ledger values  numeric(18,6)
--   customer-facing prices   numeric(14,2)
--   quantities               numeric(14,3)
--
-- Costs carry six decimals because a batch's unit cost is split across
-- locations on every transfer. At two decimals each split rounds, and the
-- residue accumulates until a fully depleted batch no longer sums back to what
-- was received. At six, `qty * unit_cost` closes exactly -- which is what makes
-- the allocation CHECK in migration 09 statable at all. Rounding happens only
-- at display.

create table if not exists core.product_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  parent_id  uuid references core.product_categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_categories_parent on core.product_categories (parent_id);

create table if not exists core.products (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null unique,
  name              text not null check (length(btrim(name)) > 0),
  category_id       uuid references core.product_categories(id) on delete set null,

  -- Goods are stocked in a base unit and often bought/sold by the pack.
  base_unit         text not null default 'piece',
  pack_unit         text,
  units_per_pack    numeric(14, 3) check (units_per_pack is null or units_per_pack > 0),

  wholesale_price   numeric(14, 2) check (wholesale_price is null or wholesale_price >= 0),
  retail_price      numeric(14, 2) check (retail_price is null or retail_price >= 0),

  -- Cost columns. Masked from staff by the public.v_products view.
  last_cost         numeric(18, 6) check (last_cost is null or last_cost >= 0),
  avg_cost          numeric(18, 6) check (avg_cost is null or avg_cost >= 0),

  reorder_point     numeric(14, 3) check (reorder_point is null or reorder_point >= 0),
  reorder_qty       numeric(14, 3) check (reorder_qty is null or reorder_qty > 0),

  track_expiry      boolean not null default false,
  shelf_life_days   int check (shelf_life_days is null or shelf_life_days > 0),

  is_active         boolean not null default true,
  created_by        uuid references core.app_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A pack unit without a conversion factor cannot be costed or counted.
  constraint products_pack_needs_factor
    check ((pack_unit is null) = (units_per_pack is null))
);

create index if not exists idx_products_active_name on core.products (is_active, name);
create index if not exists idx_products_category on core.products (category_id);

-- Fuzzy name search. Used by the product picker and by the AI agent when it
-- has to match a spoken or OCR'd product name against the catalogue.
create index if not exists idx_products_name_trgm
  on core.products using gin (name extensions.gin_trgm_ops);

drop trigger if exists trg_products_touch on core.products;
create trigger trg_products_touch
  before update on core.products
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Barcodes
--
-- A separate table rather than a column on products, because a carton and a
-- single sachet of the same product carry different barcodes. Scanning the
-- carton code must record a carton, not one sachet -- a single barcode column
-- cannot express that, and getting it wrong misstates both quantity and value.
-- ---------------------------------------------------------------------------
create table if not exists core.product_barcodes (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references core.products(id) on delete cascade,
  barcode     text not null unique,
  -- Which packaging level this code identifies: matches products.base_unit or
  -- products.pack_unit.
  unit        text not null,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_product_barcodes_product on core.product_barcodes (product_id);
create unique index if not exists idx_product_barcodes_one_primary
  on core.product_barcodes (product_id) where is_primary;

alter table core.product_categories enable row level security;
alter table core.products enable row level security;
alter table core.product_barcodes enable row level security;

drop policy if exists product_categories_read on core.product_categories;
create policy product_categories_read on core.product_categories
  for select using (auth.uid() is not null);

drop policy if exists products_read on core.products;
create policy products_read on core.products
  for select using (auth.uid() is not null);

drop policy if exists product_barcodes_read on core.product_barcodes;
create policy product_barcodes_read on core.product_barcodes
  for select using (auth.uid() is not null);

comment on column core.products.last_cost is 'Cost column. Masked from staff by public.v_products.';
comment on column core.products.avg_cost is 'Cost column. Masked from staff by public.v_products.';
