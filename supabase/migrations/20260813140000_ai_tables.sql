-- 32 · The AI layer's tables
--
-- The single structural decision here: THE MODEL NEVER WRITES STOCK.
--
-- It proposes a tool call, which lands in core.ai_tool_calls as 'proposed'. A
-- person confirms it, and only then does the app call the ordinary posting RPC
-- -- passing the tool-call id as the idempotency token, so the same proposal
-- can never post twice no matter how many times it is retried or re-confirmed.
--
-- That one choice buys three things at once: a hard stop on a runaway model, an
-- audit trail of what was suggested versus what a human accepted, and
-- idempotency for free. Everything the model can do is something a person
-- already had permission to do and explicitly approved.

create table if not exists core.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references core.app_users(id) on delete cascade,
  channel    text not null default 'chat' check (channel in ('voice', 'chat')),
  title      text,
  model      text,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

create index if not exists idx_ai_conv_user on core.ai_conversations (user_id, started_at desc);

create table if not exists core.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references core.ai_conversations(id) on delete cascade,
  seq             int not null,
  role            text not null check (role in ('user', 'assistant', 'tool')),
  -- Anthropic content is structured (text blocks, tool_use, tool_result), so
  -- storing it as jsonb keeps it replayable rather than flattening to a string.
  content         jsonb not null,
  created_at      timestamptz not null default now(),
  unique (conversation_id, seq)
);

create table if not exists core.ai_tool_calls (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid references core.ai_conversations(id) on delete cascade,
  user_id           uuid not null references core.app_users(id) on delete cascade,
  tool_name         text not null,
  input             jsonb not null,
  status            text not null default 'proposed'
                    check (status in ('proposed', 'approved', 'rejected', 'executed', 'failed')),
  -- What the confirmation actually produced, once a person accepted it.
  movement_group_id uuid,
  error             text,
  approved_by       uuid references core.app_users(id) on delete set null,
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),

  constraint tool_call_approved_consistently check ((approved_at is null) = (approved_by is null))
);

create index if not exists idx_ai_tool_calls_user on core.ai_tool_calls (user_id, created_at desc);
create index if not exists idx_ai_tool_calls_open on core.ai_tool_calls (status) where status = 'proposed';

-- ---------------------------------------------------------------------------
-- Vision: photographs of delivery notes, waybills, invoices, stock sheets.
--
-- Extraction lands in 'needs_review' and a person posts it. Cost data read off
-- a photograph is never allowed to enter the ledger unseen.
-- ---------------------------------------------------------------------------
create table if not exists core.ai_documents (
  id           uuid primary key default gen_random_uuid(),
  doc_type     text not null
               check (doc_type in ('delivery_note', 'waybill', 'supplier_invoice', 'stock_sheet')),
  status       text not null default 'extracting'
               check (status in ('extracting', 'needs_review', 'posted', 'rejected', 'failed')),
  extracted    jsonb,
  model        text,
  error        text,
  receipt_id   uuid references core.receipts(id) on delete set null,
  count_id     uuid references core.stock_counts(id) on delete set null,
  uploaded_by  uuid not null references core.app_users(id) on delete restrict,
  reviewed_by  uuid references core.app_users(id) on delete set null,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_ai_docs_status on core.ai_documents (status, created_at desc);

create table if not exists core.ai_insights (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null
               check (kind in ('reorder', 'dead_stock', 'shrinkage', 'forecast', 'expiry', 'anomaly')),
  location_id  uuid references core.locations(id) on delete cascade,
  product_id   uuid references core.products(id) on delete cascade,
  severity     text not null default 'info' check (severity in ('info', 'warn', 'critical')),
  headline     text not null,
  -- May carry cost or margin, so it is owner-only in the view.
  payload      jsonb,
  generated_at timestamptz not null default now(),
  valid_until  timestamptz,
  dismissed_at timestamptz,
  dismissed_by uuid references core.app_users(id) on delete set null,
  model        text
);

create index if not exists idx_ai_insights_live on core.ai_insights (kind, generated_at desc)
  where dismissed_at is null;

-- ---------------------------------------------------------------------------
-- What the AI costs.
--
-- Recorded per call, because a spend cap that cannot be measured is a wish. A
-- runaway voice loop should cost a warning, not a month's rent.
-- ---------------------------------------------------------------------------
create table if not exists core.ai_usage (
  id                uuid primary key default gen_random_uuid(),
  feature           text not null,
  model             text not null,
  input_tokens      int not null default 0,
  output_tokens     int not null default 0,
  cached_tokens     int not null default 0,
  cost_usd          numeric(12, 6) not null default 0,
  user_id           uuid references core.app_users(id) on delete set null,
  conversation_id   uuid references core.ai_conversations(id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_ai_usage_recent on core.ai_usage (created_at desc);

create or replace function core.ai_spend_last_24h()
returns numeric
language sql
stable
security definer
set search_path = core, public
as $$
  select coalesce(sum(cost_usd), 0)
    from core.ai_usage
   where created_at > now() - interval '24 hours'
$$;

/**
 * Raises when the rolling 24h spend is already over budget.
 * Called before every model request.
 */
create or replace function public.ai_budget_guard()
returns numeric
language plpgsql
stable
security definer
set search_path = core, public
as $$
declare
  v_spend  numeric(12, 6);
  v_budget numeric(10, 2);
begin
  select ai_daily_budget_usd into v_budget from core.app_settings where id = 1;
  v_spend := core.ai_spend_last_24h();

  if v_budget is not null and v_spend >= v_budget then
    raise exception 'the assistant has used its daily budget (%.2f of %.2f USD)', v_spend, v_budget
      using errcode = 'check_violation',
            hint = 'It resets as the last 24 hours roll forward, or raise the budget in settings.';
  end if;

  return v_spend;
end $$;

create or replace function public.ai_record_usage(
  p_feature         text,
  p_model           text,
  p_input_tokens    int default 0,
  p_output_tokens   int default 0,
  p_cached_tokens   int default 0,
  p_cost_usd        numeric default 0,
  p_conversation_id uuid default null
)
returns void
language sql
security definer
set search_path = core, public
as $$
  insert into core.ai_usage
    (feature, model, input_tokens, output_tokens, cached_tokens, cost_usd, user_id, conversation_id)
  values
    (p_feature, p_model, p_input_tokens, p_output_tokens, p_cached_tokens,
     coalesce(p_cost_usd, 0), auth.uid(), p_conversation_id)
$$;

-- ---------------------------------------------------------------------------
-- Proposals
-- ---------------------------------------------------------------------------
create or replace function public.ai_propose_tool_call(
  p_tool_name       text,
  p_input           jsonb,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  insert into core.ai_tool_calls (conversation_id, user_id, tool_name, input)
  values (p_conversation_id, auth.uid(), p_tool_name, p_input)
  returning id into v_id;

  return v_id;
end $$;

/**
 * Marks a proposal as accepted or refused.
 *
 * Only the person it was proposed to may answer it -- an assistant suggestion
 * is not a shared queue, and one user must not be able to accept work the model
 * offered to somebody else with different permissions.
 */
create or replace function public.ai_resolve_tool_call(
  p_id                uuid,
  p_status            text,
  p_movement_group_id uuid default null,
  p_error             text default null
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_owner uuid;
  v_state text;
begin
  select user_id, status into v_owner, v_state from core.ai_tool_calls where id = p_id;

  if v_owner is null then
    raise exception 'no such proposal' using errcode = 'no_data_found';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'that suggestion was made to someone else'
      using errcode = 'insufficient_privilege';
  end if;

  if v_state <> 'proposed' then
    raise exception 'this suggestion has already been %', v_state
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if p_status not in ('approved', 'rejected', 'executed', 'failed') then
    raise exception 'unknown outcome %', p_status using errcode = 'invalid_parameter_value';
  end if;

  update core.ai_tool_calls
     set status            = p_status,
         movement_group_id = p_movement_group_id,
         error             = p_error,
         approved_by       = case when p_status in ('approved', 'executed') then auth.uid() end,
         approved_at       = case when p_status in ('approved', 'executed') then now() end
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
drop view if exists public.v_ai_usage;
create or replace view public.v_ai_usage
  with (security_barrier = true, security_invoker = false) as
select date_trunc('day', u.created_at) as day,
       u.feature,
       u.model,
       sum(u.input_tokens)  as input_tokens,
       sum(u.output_tokens) as output_tokens,
       sum(u.cost_usd)::text as cost_usd,
       count(*)             as calls
  from core.ai_usage u
 where public.is_owner()
 group by 1, 2, 3
 order by 1 desc;

drop view if exists public.v_ai_insights;
create or replace view public.v_ai_insights
  with (security_barrier = true, security_invoker = false) as
select i.id,
       i.kind,
       i.severity,
       i.headline,
       case when public.is_owner() then i.payload end as payload,
       i.location_id,
       l.code as location_code,
       i.product_id,
       p.name as product_name,
       i.generated_at,
       i.valid_until
  from core.ai_insights i
  left join core.locations l on l.id = i.location_id
  left join core.products p  on p.id = i.product_id
 where i.dismissed_at is null
   and public.is_owner()
 order by
   case i.severity when 'critical' then 0 when 'warn' then 1 else 2 end,
   i.generated_at desc;

grant select on public.v_ai_usage, public.v_ai_insights to authenticated;

revoke all on function public.ai_budget_guard() from public;
revoke all on function public.ai_record_usage(text, text, int, int, int, numeric, uuid) from public;
revoke all on function public.ai_propose_tool_call(text, jsonb, uuid) from public;
revoke all on function public.ai_resolve_tool_call(uuid, text, uuid, text) from public;

grant execute on function public.ai_budget_guard() to authenticated;
grant execute on function public.ai_record_usage(text, text, int, int, int, numeric, uuid) to authenticated;
grant execute on function public.ai_propose_tool_call(text, jsonb, uuid) to authenticated;
grant execute on function public.ai_resolve_tool_call(uuid, text, uuid, text) to authenticated;

alter table core.ai_conversations enable row level security;
alter table core.ai_messages enable row level security;
alter table core.ai_tool_calls enable row level security;
alter table core.ai_documents enable row level security;
alter table core.ai_insights enable row level security;
alter table core.ai_usage enable row level security;

comment on table core.ai_tool_calls is
  'Model proposals. Execution passes the row id as the idempotency token, so a proposal can never post twice.';
