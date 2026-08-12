-- 34 · Reports, and the numbers the AI reasons over
--
-- These are the only things the reporting assistant can run. It picks a report
-- and its arguments; it never writes SQL. A model that can compose queries can
-- read anything the connection reaches, and the whole point of the `core`
-- schema is that nothing can.
--
-- Every one is owner-gated, because they all return cost or margin.

create or replace function public.report_stock_value_series(p_days int default 30)
returns table (day date, location_code text, stock_value text)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  return query
    select d::date,
           l.code,
           coalesce(sum(m.value_delta), 0)::text
      from generate_series(
             (now() at time zone 'UTC')::date - greatest(p_days, 1),
             (now() at time zone 'UTC')::date,
             interval '1 day') d
     cross join core.locations l
      left join core.stock_movements m
             on m.location_id = l.id
            and m.occurred_at < (d::date + 1)::timestamptz
     where l.is_active
     group by d, l.code
     order by d, l.code;
end $$;

create or replace function public.report_margin_by_product(p_days int default 30)
returns table (
  product   text,
  sku       text,
  qty_sold  numeric,
  revenue   text,
  cost      text,
  margin    text,
  margin_pct text
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  return query
    select p.name,
           p.sku,
           sum(sl.qty),
           sum(sl.line_total)::text,
           sum(sl.cogs)::text,
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

/**
 * Stock that has not moved. The money sitting still on a shelf.
 */
create or replace function public.report_dead_stock(p_days int default 60)
returns table (
  product      text,
  location     text,
  qty_on_hand  numeric,
  tied_up      text,
  last_moved   timestamptz,
  days_still   int
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  return query
    select p.name,
           l.code,
           sl.qty_on_hand,
           sl.total_cost_value::text,
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

/**
 * Stock lost rather than sold: damage, expiry, and counted-away shortfalls.
 */
create or replace function public.report_shrinkage(p_days int default 90)
returns table (
  product     text,
  location    text,
  kind        text,
  qty_lost    numeric,
  value_lost  text
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  return query
    select p.name,
           l.code,
           m.type::text,
           -sum(m.qty_delta),
           (-sum(m.value_delta))::text
      from core.stock_movements m
      join core.products p  on p.id = m.product_id
      join core.locations l on l.id = m.location_id
     where m.type in ('damage', 'expiry_writeoff', 'count_decrease')
       and m.occurred_at > now() - make_interval(days => greatest(p_days, 1))
     group by p.name, l.code, m.type
     order by (-sum(m.value_delta)) desc
     limit 50;
end $$;

/**
 * What to buy, and roughly how urgently, from how fast it has been going out.
 */
create or replace function public.report_reorder_suggestions()
returns table (
  product        text,
  sku            text,
  location       text,
  qty_on_hand    numeric,
  reorder_point  numeric,
  daily_rate     numeric,
  days_of_cover  numeric,
  suggested_qty  numeric
)
language plpgsql
stable
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  return query
    with outflow as (
      select m.product_id, m.location_id,
             -sum(m.qty_delta) / 30.0 as per_day
        from core.stock_movements m
       where m.type in ('wholesale_sale', 'retail_sale', 'transfer_out')
         and m.occurred_at > now() - interval '30 days'
       group by m.product_id, m.location_id
    )
    select p.name,
           p.sku,
           l.code,
           sl.qty_on_hand,
           p.reorder_point,
           round(coalesce(o.per_day, 0), 3),
           case when coalesce(o.per_day, 0) > 0
                then round(sl.qty_on_hand / o.per_day, 1) end,
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

-- ---------------------------------------------------------------------------
-- Writing an insight. Called by the scheduled job after the model has looked at
-- the numbers above.
-- ---------------------------------------------------------------------------
create or replace function public.ai_write_insight(
  p_kind        text,
  p_severity    text,
  p_headline    text,
  p_payload     jsonb default null,
  p_product_id  uuid default null,
  p_location_id uuid default null,
  p_model       text default null,
  p_valid_days  int default 7
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null and current_setting('role', true) <> 'service_role' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  -- Supersede the previous one of this kind for the same subject rather than
  -- stacking duplicates every time the job runs.
  update core.ai_insights
     set dismissed_at = now()
   where kind = p_kind
     and dismissed_at is null
     and product_id is not distinct from p_product_id
     and location_id is not distinct from p_location_id;

  insert into core.ai_insights
    (kind, severity, headline, payload, product_id, location_id, model, valid_until)
  values
    (p_kind, p_severity, p_headline, p_payload, p_product_id, p_location_id, p_model,
     now() + make_interval(days => greatest(p_valid_days, 1)))
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.ai_dismiss_insight(p_id uuid)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();
  update core.ai_insights
     set dismissed_at = now(), dismissed_by = auth.uid()
   where id = p_id;
end $$;

revoke all on function public.report_stock_value_series(int) from public;
revoke all on function public.report_margin_by_product(int) from public;
revoke all on function public.report_dead_stock(int) from public;
revoke all on function public.report_shrinkage(int) from public;
revoke all on function public.report_reorder_suggestions() from public;
revoke all on function public.ai_write_insight(text, text, text, jsonb, uuid, uuid, text, int) from public;
revoke all on function public.ai_dismiss_insight(uuid) from public;

grant execute on function public.report_stock_value_series(int) to authenticated;
grant execute on function public.report_margin_by_product(int) to authenticated;
grant execute on function public.report_dead_stock(int) to authenticated;
grant execute on function public.report_shrinkage(int) to authenticated;
grant execute on function public.report_reorder_suggestions() to authenticated;
grant execute on function public.ai_write_insight(text, text, text, jsonb, uuid, uuid, text, int) to authenticated, service_role;
grant execute on function public.ai_dismiss_insight(uuid) to authenticated;
