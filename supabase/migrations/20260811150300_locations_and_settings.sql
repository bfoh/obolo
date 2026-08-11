-- 04 · Locations, per-user location access, and company settings

create table if not exists core.locations (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  kind       public.location_kind not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `in_transit` is a synthetic location holding stock that has left the
-- warehouse but has not yet been confirmed at the shop. Without it, company
-- value drops when a van leaves and reappears when it arrives, and a
-- short-receipt vanishes silently. With it, a shortfall stays parked here as an
-- unresolved balance that the valuation report surfaces until someone writes it
-- off or explains it -- which makes it a genuine shrinkage detector.
--
-- Exactly one such location may exist, or "where is the stock in transit"
-- stops having a single answer.
create unique index if not exists idx_locations_single_transit
  on core.locations (kind) where kind = 'in_transit';

create index if not exists idx_locations_active on core.locations (kind) where is_active;

drop trigger if exists trg_locations_touch on core.locations;
create trigger trg_locations_touch
  before update on core.locations
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Which locations a user may see and post to.
--
-- Explicit rows rather than deriving access from the role, so opening a second
-- shop is a data change instead of a schema change.
-- ---------------------------------------------------------------------------
create table if not exists core.user_locations (
  user_id     uuid not null references core.app_users(id) on delete cascade,
  location_id uuid not null references core.locations(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, location_id)
);

create index if not exists idx_user_locations_location on core.user_locations (location_id);

create or replace function public.can_access_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  select public.is_owner()
      or exists (
        select 1
          from core.user_locations ul
         where ul.user_id = auth.uid()
           and ul.location_id = p_location_id
      )
$$;

revoke all on function public.can_access_location(uuid) from public;
grant execute on function public.can_access_location(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The caller's own identity, role and reachable locations, in one round trip.
--
-- `core` is not served by PostgREST, so this is how the app learns who it is
-- talking to. Takes no arguments by design: a SECURITY DEFINER function that
-- accepts a user id lets any authenticated caller read anyone else's profile.
-- ---------------------------------------------------------------------------
create or replace function public.me()
returns table (
  id           uuid,
  full_name    text,
  email        text,
  role         public.user_role,
  status       text,
  location_ids uuid[]
)
language sql
stable
security definer
set search_path = core, public
as $$
  select u.id,
         u.full_name,
         u.email,
         u.role,
         u.status,
         coalesce(
           array_agg(ul.location_id) filter (where ul.location_id is not null),
           '{}'::uuid[]
         ) as location_ids
    from core.app_users u
    left join core.user_locations ul on ul.user_id = u.id
   where u.id = auth.uid()
     and u.status = 'active'
   group by u.id, u.full_name, u.email, u.role, u.status
$$;

revoke all on function public.me() from public;
grant execute on function public.me() to authenticated;

alter table core.locations enable row level security;
alter table core.user_locations enable row level security;

drop policy if exists locations_read on core.locations;
create policy locations_read on core.locations
  for select using (public.can_access_location(id));

drop policy if exists user_locations_read on core.user_locations;
create policy user_locations_read on core.user_locations
  for select using (user_id = auth.uid() or public.is_owner());

-- ---------------------------------------------------------------------------
-- Company settings
--
-- OBOLO serves one company, so this is a single row rather than a tenant table.
-- The CHECK is what keeps it single.
-- ---------------------------------------------------------------------------
create table if not exists core.app_settings (
  id                   smallint primary key default 1 check (id = 1),
  company_name         text not null default 'OBOLO',
  tin                  text,
  address              text,
  phone                text,
  currency             char(3) not null default 'GHS',
  -- Lead time for "expiring soon" alerts, in days before expiry_date.
  expiry_alert_days    int not null default 30 check (expiry_alert_days between 0 and 365),
  -- Ceiling on rolling 24h AI spend. A runaway voice loop should cost a warning.
  ai_daily_budget_usd  numeric(10, 2) not null default 5.00 check (ai_daily_budget_usd >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

insert into core.app_settings (id) values (1) on conflict (id) do nothing;

-- Company name for the app shell. A narrow reader rather than exposing the
-- whole settings row, which also carries the AI budget.
create or replace function public.company_name()
returns text
language sql
stable
security definer
set search_path = core, public
as $$
  select company_name from core.app_settings where id = 1
$$;

revoke all on function public.company_name() from public;
grant execute on function public.company_name() to authenticated;

drop trigger if exists trg_app_settings_touch on core.app_settings;
create trigger trg_app_settings_touch
  before update on core.app_settings
  for each row execute function core.touch_updated_at();

alter table core.app_settings enable row level security;

drop policy if exists app_settings_read on core.app_settings;
create policy app_settings_read on core.app_settings
  for select using (auth.uid() is not null);

comment on table core.locations is
  'Warehouse, retail shop, and the synthetic in_transit location that holds dispatched-but-unconfirmed stock.';
