-- 11 · Append-only guards
--
-- Triggers rather than revokes. A SECURITY DEFINER function runs as the table
-- owner and sails straight past any GRANT, so privileges alone would not stop
-- the very code most likely to do the damage -- our own RPCs. A trigger stops
-- everything short of disabling the trigger.
--
-- There is deliberately no voided_at column on stock_movements. Marking an
-- original as void would require updating it, which would mean carving an
-- exception into this guard. Whether a movement was reversed is instead derived
-- from the existence of its reversal, which the unique index on
-- reverses_movement_id makes a cheap lookup.

create or replace function core.deny_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only; post a reversal instead of % ing it',
    tg_table_name, lower(tg_op)
    using errcode = 'restrict_violation',
          hint = 'Use public.reverse_movement() to undo a posting.';
end $$;

drop trigger if exists trg_movements_append_only on core.stock_movements;
create trigger trg_movements_append_only
  before update or delete on core.stock_movements
  for each row execute function core.deny_mutation();

drop trigger if exists trg_allocations_append_only on core.movement_batch_allocations;
create trigger trg_allocations_append_only
  before update or delete on core.movement_batch_allocations
  for each row execute function core.deny_mutation();

-- ---------------------------------------------------------------------------
-- Batches are derived, not append-only: qty_remaining moves as stock is drawn.
-- But only that column may move, and a batch may never be deleted -- deleting
-- one would strand every allocation that priced against it.
-- ---------------------------------------------------------------------------
create or replace function core.guard_batch_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'stock batches cannot be deleted; they carry cost history'
      using errcode = 'restrict_violation';
  end if;

  if new.id                 is distinct from old.id
     or new.product_id      is distinct from old.product_id
     or new.location_id     is distinct from old.location_id
     or new.qty_received    is distinct from old.qty_received
     or new.unit_cost       is distinct from old.unit_cost
     or new.origin_received_at is distinct from old.origin_received_at
     or new.created_movement_id is distinct from old.created_movement_id
  then
    raise exception 'only qty_remaining may change on a posted batch'
      using errcode = 'restrict_violation',
            hint = 'Cost and identity are fixed at creation. Post a correction instead.';
  end if;

  return new;
end $$;

drop trigger if exists trg_batches_guard on core.stock_batches;
create trigger trg_batches_guard
  before update or delete on core.stock_batches
  for each row execute function core.guard_batch_mutation();
