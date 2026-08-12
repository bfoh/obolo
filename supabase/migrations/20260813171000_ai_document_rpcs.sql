-- 35 · Handling a photographed document
--
-- Extraction lands in 'needs_review' and stays there until a person posts it.
-- There is deliberately no path from a photograph straight into the ledger:
-- a misread digit on a delivery note becomes a wrong valuation, and the whole
-- app exists to not be wrong about that.

create or replace function public.ai_create_document(p_doc_type text)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_id uuid;
begin
  perform core.require_owner();

  insert into core.ai_documents (doc_type, uploaded_by)
  values (p_doc_type, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.ai_save_extraction(
  p_id        uuid,
  p_extracted jsonb,
  p_model     text default null
)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  perform core.require_owner();

  update core.ai_documents
     set extracted = p_extracted,
         model     = p_model,
         status    = 'needs_review'
   where id = p_id;
end $$;

create or replace function public.ai_fail_document(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = core, public
as $$
begin
  update core.ai_documents
     set status = 'failed', error = p_error
   where id = p_id and uploaded_by = auth.uid();
end $$;

/**
 * Turns a reviewed extraction into a draft delivery.
 *
 * Only lines the person has matched to a real product and confirmed a cost for
 * come across. Anything the model was unsure about simply does not arrive here
 * -- it was dropped in review, on screen, by someone who looked at the paper.
 */
create or replace function public.ai_document_to_receipt(
  p_document_id uuid,
  p_lines       jsonb,
  p_supplier_id uuid default null,
  p_waybill_no  text default null
)
returns uuid
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_receipt uuid;
  v_line    jsonb;
  v_count   int := 0;
begin
  perform core.require_owner();

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'nothing was confirmed to bring in'
      using errcode = 'invalid_parameter_value';
  end if;

  v_receipt := public.create_receipt(null, p_supplier_id, p_waybill_no);

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    perform public.set_receipt_line(
      v_receipt,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'qty')::numeric,
      (v_line ->> 'unit_cost')::numeric,
      nullif(v_line ->> 'expiry_date', '')::date,
      nullif(v_line ->> 'lot_code', '')
    );
    v_count := v_count + 1;
  end loop;

  update core.ai_documents
     set status      = 'posted',
         receipt_id  = v_receipt,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_document_id;

  return v_receipt;
end $$;

drop view if exists public.v_ai_documents;
create or replace view public.v_ai_documents
  with (security_barrier = true, security_invoker = false) as
select d.id,
       d.doc_type,
       d.status,
       d.extracted,
       d.model,
       d.error,
       d.receipt_id,
       d.created_at,
       d.reviewed_at
  from core.ai_documents d
 where public.is_owner();

grant select on public.v_ai_documents to authenticated;

revoke all on function public.ai_create_document(text) from public;
revoke all on function public.ai_save_extraction(uuid, jsonb, text) from public;
revoke all on function public.ai_fail_document(uuid, text) from public;
revoke all on function public.ai_document_to_receipt(uuid, jsonb, uuid, text) from public;

grant execute on function public.ai_create_document(text) to authenticated;
grant execute on function public.ai_save_extraction(uuid, jsonb, text) to authenticated;
grant execute on function public.ai_fail_document(uuid, text) to authenticated;
grant execute on function public.ai_document_to_receipt(uuid, jsonb, uuid, text) to authenticated;
