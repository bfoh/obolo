-- 33 · What the assistant is allowed to look up
--
-- Every one of these goes through the same masked view the interface uses, and
-- runs as the caller. The assistant is therefore incapable of reporting
-- something its user could not already read: a staff member's assistant sees
-- quantities and nulls where cost would be, exactly as the staff member does.
--
-- They exist as named functions rather than letting the model compose queries
-- because a model that can write its own SQL can read anything the connection
-- can reach. Fixed shapes, fixed filters, no free-form access.

create or replace function public.ai_stock_lookup(p_search text)
returns table (
  product      text,
  sku          text,
  location     text,
  qty_on_hand  numeric,
  unit         text,
  stock_value  text
)
language sql
stable
security definer
set search_path = core, public
as $$
  select v.product_name, v.sku, v.location_code, v.qty_on_hand, v.base_unit, v.total_cost_value
    from public.v_stock_levels v
   where p_search is not null
     and (v.product_name ilike '%' || btrim(p_search) || '%'
       or v.sku ilike '%' || btrim(p_search) || '%')
   order by v.product_name, v.location_code
   limit 20
$$;

create or replace function public.ai_low_stock()
returns table (
  product     text,
  location    text,
  qty_on_hand numeric,
  reorder_at  numeric
)
language sql
stable
security definer
set search_path = core, public
as $$
  select v.product_name, v.location_code, v.qty_on_hand, v.reorder_point
    from public.v_low_stock v
   order by v.qty_on_hand
   limit 25
$$;

create or replace function public.ai_expiring()
returns table (
  product        text,
  location       text,
  qty_remaining  numeric,
  expiry_date    date,
  days_remaining int
)
language sql
stable
security definer
set search_path = core, public
as $$
  select v.product_name, v.location_code, v.qty_remaining, v.expiry_date, v.days_remaining
    from public.v_expiring_soon v
   order by v.expiry_date
   limit 25
$$;

create or replace function public.ai_receivables()
returns table (
  customer  text,
  balance   text,
  phone     text
)
language sql
stable
security definer
set search_path = core, public
as $$
  select v.name, v.balance, v.phone
    from public.v_customers v
   where v.balance::numeric > 0
   order by v.balance::numeric desc
   limit 25
$$;

revoke all on function public.ai_stock_lookup(text) from public;
revoke all on function public.ai_low_stock() from public;
revoke all on function public.ai_expiring() from public;
revoke all on function public.ai_receivables() from public;

grant execute on function public.ai_stock_lookup(text) to authenticated;
grant execute on function public.ai_low_stock() to authenticated;
grant execute on function public.ai_expiring() to authenticated;
grant execute on function public.ai_receivables() to authenticated;
