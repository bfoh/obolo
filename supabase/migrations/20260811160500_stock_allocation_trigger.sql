-- 12 · The sole writer of stock positions
--
-- core.stock_batches.qty_remaining and core.stock_levels are maintained here
-- and nowhere else. The maintenance hangs off the allocation insert rather than
-- living inside post_movement() on purpose: inserting an allocation is the only
-- way stock can move at all, so putting it here means the position stays correct
-- for ANY writer -- a future RPC, a service-role job, a migration, the SQL
-- editor -- instead of only for the code paths that remembered to call it.
--
-- The app this replaces kept its quantity cache in browser TypeScript, issuing
-- separate UPDATE statements with no transaction and no lock. Any interruption
-- mid-loop left it permanently wrong, with nothing to detect that it had.

create or replace function core.apply_allocation()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_product_id  uuid;
  v_location_id uuid;
begin
  -- The batch's own CHECK constraints fire on this UPDATE. They are the last
  -- line of defence: even if every layer above fails, the database refuses to
  -- hold negative stock or to return more units than a batch ever received.
  update core.stock_batches
     set qty_remaining = qty_remaining + new.qty_delta
   where id = new.batch_id
   returning product_id, location_id into v_product_id, v_location_id;

  if v_product_id is null then
    raise exception 'allocation % references a batch that does not exist', new.batch_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Deliberately two statements rather than one INSERT ... ON CONFLICT DO
  -- UPDATE. An upsert evaluates CHECK constraints against the *proposed insert
  -- row* before it looks for a conflict, and only unique violations divert to
  -- the UPDATE branch. Since the row being offered here carries a DELTA
  -- (-100 units) while stock_levels_non_negative asserts a STATE (>= 0), every
  -- outbound movement would fail the check before the upsert could add the
  -- delta to the existing balance.
  --
  -- Ensuring the row exists at zero and then updating it applies the delta to
  -- real state, which is what the constraint is there to guard.
  insert into core.stock_levels (product_id, location_id, qty_on_hand, total_cost_value)
  values (v_product_id, v_location_id, 0, 0)
  on conflict (product_id, location_id) do nothing;

  update core.stock_levels
     set qty_on_hand      = qty_on_hand + new.qty_delta,
         total_cost_value = total_cost_value + new.value_delta,
         updated_at       = now()
   where product_id = v_product_id
     and location_id = v_location_id;

  return new;
end $$;

drop trigger if exists trg_apply_allocation on core.movement_batch_allocations;
create trigger trg_apply_allocation
  after insert on core.movement_batch_allocations
  for each row execute function core.apply_allocation();

comment on function core.apply_allocation() is
  'Sole writer of stock_batches.qty_remaining and stock_levels. Do not maintain either anywhere else.';
