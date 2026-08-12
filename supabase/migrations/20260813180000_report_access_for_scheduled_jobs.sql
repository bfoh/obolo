-- 36 · Let the scheduled job read the reports
--
-- The nightly insight run has no user session -- it is a cron trigger, not a
-- person -- so auth.uid() is null and every report gated on require_owner()
-- came back empty. The job dutifully reported "nothing worth reporting" about a
-- warehouse that had just written off seven jerrycans.
--
-- The reports stay owner-only for anyone signed in. The exception is the
-- service role, which is only reachable with the secret key from the server, is
-- never held by a browser, and already bypasses RLS everywhere -- so it gains
-- nothing here it did not already have.

create or replace function core.require_report_access()
returns void
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  if public.is_owner() then
    return;
  end if;

  -- PostgREST sets the role from the key's JWT claim, so this is true only for
  -- a caller holding the service key.
  if current_setting('role', true) = 'service_role' then
    return;
  end if;

  raise exception 'reports are for the owner'
    using errcode = 'insufficient_privilege';
end $$;

-- Swap the guard on each report. Bodies are unchanged.
create or replace function public.report_stock_value_series(p_days int default 30)
returns table (day date, location_code text, stock_value text)
language plpgsql stable security definer set search_path = core, public
as $$
begin
  perform core.require_report_access();
  return query
    select d::date, l.code, coalesce(sum(m.value_delta), 0)::text
      from generate_series(
             (now() at time zone 'UTC')::date - greatest(p_days, 1),
             (now() at time zone 'UTC')::date, interval '1 day') d
     cross join core.locations l
      left join core.stock_movements m
             on m.location_id = l.id and m.occurred_at < (d::date + 1)::timestamptz
     where l.is_active
     group by d, l.code
     order by d, l.code;
end $$;

create or replace function public.report_margin_by_product(p_days int default 30)
returns table (
  product text, sku text, qty_sold numeric,
  revenue text, cost text, margin text, margin_pct text
)
language plpgsql stable security definer set search_path = core, public
as $$
begin
  perform core.require_report_access();
  return query
    select p.name, p.sku, sum(sl.qty),
           sum(sl.line_total)::text, sum(sl.cogs)::text,
           (sum(sl.line_total) - sum(sl.cogs))::text,
           case when sum(sl.line_total) > 0
                then round((sum(sl.line_total) - sum(sl.cogs)) / sum(sl.line_total) * 100, 1)::text
           end
      from core.sales_order_lines sl
      join core.sales_orders o on o.id = sl.order_id
      join core.products p     on p.id = sl.product_id
     where o.status = 'fulfilled'
       and o.occurred_at > now() - make_interval(days => greatest(p_days, 1))
     group by p.name, p.sku
     order by (sum(sl.line_total) - sum(sl.cogs)) desc
     limit 50;
end $$;

create or replace function public.report_dead_stock(p_days int default 60)
returns table (
  product text, location text, qty_on_hand numeric,
  tied_up text, last_moved timestamptz, days_still int
)
language plpgsql stable security definer set search_path = core, public
as $$
begin
  perform core.require_report_access();
  return query
    select p.name, l.code, sl.qty_on_hand, sl.total_cost_value::text,
           last_out.moved_at,
           coalesce(extract(day from now() - last_out.moved_at)::int, 9999)
      from core.stock_levels sl
      join core.products p  on p.id = sl.product_id
      join core.locations l on l.id = sl.location_id
      left join lateral (
        select max(m.occurred_at) as moved_at
          from core.stock_movements m
         where m.product_id = sl.product_id
           and m.location_id = sl.location_id
           and m.qty_delta < 0
      ) last_out on true
     where sl.qty_on_hand > 0
       and (last_out.moved_at is null
            or last_out.moved_at < now() - make_interval(days => greatest(p_days, 1)))
     order by sl.total_cost_value desc
     limit 50;
end $$;

create or replace function public.report_shrinkage(p_days int default 90)
returns table (product text, location text, kind text, qty_lost numeric, value_lost text)
language plpgsql stable security definer set search_path = core, public
as $$
begin
  perform core.require_report_access();
  return query
    select p.name, l.code, m.type::text, -sum(m.qty_delta), (-sum(m.value_delta))::text
      from core.stock_movements m
      join core.products p  on p.id = m.product_id
      join core.locations l on l.id = m.location_id
     where m.type in ('damage', 'expiry_writeoff', 'count_decrease')
       and m.occurred_at > now() - make_interval(days => greatest(p_days, 1))
     group by p.name, l.code, m.type
     order by (-sum(m.value_delta)) desc
     limit 50;
end $$;

create or replace function public.report_reorder_suggestions()
returns table (
  product text, sku text, location text, qty_on_hand numeric,
  reorder_point numeric, daily_rate numeric, days_of_cover numeric, suggested_qty numeric
)
language plpgsql stable security definer set search_path = core, public
as $$
begin
  perform core.require_report_access();
  return query
    with outflow as (
      select m.product_id, m.location_id, -sum(m.qty_delta) / 30.0 as per_day
        from core.stock_movements m
       where m.type in ('wholesale_sale', 'retail_sale', 'transfer_out')
         and m.occurred_at > now() - interval '30 days'
       group by m.product_id, m.location_id
    )
    select p.name, p.sku, l.code, sl.qty_on_hand, p.reorder_point,
           round(coalesce(o.per_day, 0), 3),
           case when coalesce(o.per_day, 0) > 0 then round(sl.qty_on_hand / o.per_day, 1) end,
           coalesce(p.reorder_qty, greatest(coalesce(p.reorder_point, 0) * 2 - sl.qty_on_hand, 0))
      from core.stock_levels sl
      join core.products p  on p.id = sl.product_id
      join core.locations l on l.id = sl.location_id
      left join outflow o   on o.product_id = sl.product_id and o.location_id = sl.location_id
     where p.is_active
       and (
         (p.reorder_point is not null and sl.qty_on_hand <= p.reorder_point)
         or (coalesce(o.per_day, 0) > 0 and sl.qty_on_hand / o.per_day < 14)
       )
     order by case when coalesce(o.per_day, 0) > 0 then sl.qty_on_hand / o.per_day else 999 end
     limit 50;
end $$;

-- The expiry list the job also reads is a view, and a definer view evaluates
-- can_access_location() as the caller -- which is nobody for a cron run. Give
-- the job a function it can actually read.
create or replace function public.report_expiring(p_days int default 30)
returns table (
  product text, location text, qty_remaining numeric,
  expiry_date date, days_remaining int, at_risk_value text
)
language plpgsql stable security definer set search_path = core, public
as $$
begin
  perform core.require_report_access();
  return query
    select p.name, l.code, b.qty_remaining, b.expiry_date,
           (b.expiry_date - (now() at time zone 'UTC')::date)::int,
           round(b.qty_remaining * b.unit_cost, 6)::text
      from core.stock_batches b
      join core.products p  on p.id = b.product_id
      join core.locations l on l.id = b.location_id
     where b.qty_remaining > 0
       and b.expiry_date is not null
       and b.expiry_date <= (now() at time zone 'UTC')::date + greatest(p_days, 1)
     order by b.expiry_date
     limit 25;
end $$;

grant execute on function public.report_stock_value_series(int) to authenticated, service_role;
grant execute on function public.report_margin_by_product(int) to authenticated, service_role;
grant execute on function public.report_dead_stock(int) to authenticated, service_role;
grant execute on function public.report_shrinkage(int) to authenticated, service_role;
grant execute on function public.report_reorder_suggestions() to authenticated, service_role;
revoke all on function public.report_expiring(int) from public;
grant execute on function public.report_expiring(int) to authenticated, service_role;
