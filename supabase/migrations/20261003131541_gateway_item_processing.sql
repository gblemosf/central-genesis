-- Gateways keep their own authentication, payload contract and durable inbox.
-- Only validated, reconciled line items enter this internal storage routine.
create function public.store_gateway_items(p_connection_id uuid, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
<<gateway>>
declare
  c public.integration_connections%rowtype; i jsonb; mapped_items jsonb := '[]';
  product_id uuid; project_id uuid; event_project uuid; stage_id uuid; mapping_id uuid;
  stage_name text; stage_type public.funnel_stage_type; sale_id uuid; original_id uuid;
  status text; transaction_id text; event_time timestamptz; currency text; sign integer;
  gross numeric; net numeric; item_total numeric := 0; item_net numeric := 0; item_fee numeric := 0;
  contact_id uuid; email_id uuid; phone_id uuid; email text; phone text; name text;
  campaign_id uuid; touch_id uuid; utm jsonb; sale_payload jsonb; original_payload jsonb;
  original_time timestamptz; original_project uuid; existing_products text[]; incoming_products text[];
  mapping_reason text; latest_event_time timestamptz;
begin
  select * into c from public.integration_connections where id = p_connection_id
    and provider in ('payt','assiny') and revoked_at is null for update;
  if not found or p_event ->> 'provider' is distinct from c.provider::text then raise exception 'active gateway connection required'; end if;
  if p_event ->> 'sandbox' = 'true' then return jsonb_build_object('state','test','mapped',false); end if;
  status := p_event ->> 'status'; transaction_id := p_event ->> 'transaction_id'; currency := p_event ->> 'currency';
  event_time := (p_event ->> 'occurred_at')::timestamptz; gross := (p_event #>> '{financial,gross}')::numeric;
  net := (p_event #>> '{financial,net_after_fees}')::numeric;
  if status is null or status not in ('paid','refunded','chargeback','pending','abandoned','failed','expired')
    or coalesce(length(transaction_id),0) not between 1 and 300 or currency is null or currency !~ '^[A-Z]{3}$'
    or event_time is null or gross is null or gross < 0 or gross >= 1000000000000
    or jsonb_typeof(p_event -> 'items') is distinct from 'array'
    or jsonb_array_length(p_event -> 'items') not between 1 and 50 then raise exception 'invalid normalized gateway event'; end if;
  select array_agg(x ->> 'product_external_id' order by x ->> 'product_external_id') into incoming_products from jsonb_array_elements(p_event -> 'items') x;
  if cardinality(incoming_products) <> (select count(distinct x) from unnest(incoming_products) x) then raise exception 'duplicate gateway product'; end if;
  select id,project_id,payload,event_at into original_id,original_project,original_payload,original_time from public.sales_events
    where connection_id = c.id and external_transaction_id = transaction_id and event_type in ('PURCHASE_APPROVED','PURCHASE_COMPLETED') for update;
  if original_id is not null then
    select array_agg(p.external_id order by p.external_id) into existing_products from public.sales_event_items si join public.products p on p.id=si.product_id where si.sales_event_id=original_id;
    if incoming_products is distinct from existing_products then raise exception 'gateway transaction items changed'; end if;
    if exists(select 1 from public.sales_events where id=original_id and currency <> gateway.currency) then raise exception 'gateway currency changed'; end if;
  end if;
  for i in select value from jsonb_array_elements(p_event -> 'items') loop
    if coalesce(length(i ->> 'product_external_id'),0) not between 1 and 300 or coalesce(length(i ->> 'product_name'),0) not between 1 and 500
      or (i ->> 'quantity')::integer <> 1 or (i #>> '{financial,gross}')::numeric < 0 then raise exception 'invalid gateway item'; end if;
    item_total := item_total + (i #>> '{financial,gross}')::numeric;
    item_net := item_net + coalesce((i #>> '{financial,net_after_fees}')::numeric,0);
    item_fee := item_fee + coalesce((i #>> '{financial,platform_fee}')::numeric,0);
    if status in ('paid','refunded','chargeback') and ((i #>> '{financial,net_after_fees}') is null or (i #>> '{financial,platform_fee}') is null
      or (i #>> '{financial,net_after_fees}')::numeric < 0 or (i #>> '{financial,platform_fee}')::numeric < 0
      or (i #>> '{financial,gross}')::numeric <> (i #>> '{financial,net_after_fees}')::numeric + (i #>> '{financial,platform_fee}')::numeric) then raise exception 'unreconciled gateway item'; end if;
    insert into public.products(organization_id,connection_id,external_id,name,current_price,currency,source,provider_name,provider_price,provider_currency,metadata)
    values(c.organization_id,c.id,i ->> 'product_external_id',i ->> 'product_name',(i #>> '{financial,gross}')::numeric,currency,'provider',i ->> 'product_name',(i #>> '{financial,gross}')::numeric,currency,jsonb_build_object('provider',c.provider))
    on conflict(connection_id,external_id) do update set provider_name=excluded.provider_name,provider_price=excluded.provider_price,provider_currency=excluded.provider_currency,
      name=case when public.products.metadata ->> 'manual_override'='true' then public.products.name else excluded.name end,
      current_price=case when public.products.metadata ->> 'manual_override'='true' then public.products.current_price else excluded.current_price end
    returning id into product_id;
  end loop;
  -- Discover the entire invoice before deciding whether its mappings are ready.
  for i in select value from jsonb_array_elements(p_event -> 'items') loop
    select id into product_id from public.products where connection_id=c.id and external_id=i ->> 'product_external_id';
    project_id:=null; stage_id:=null; mapping_id:=null; stage_name:=null; stage_type:=null;
    if original_id is not null then
      select original_project,si.funnel_stage_id,si.product_mapping_id,si.funnel_stage_name_snapshot,si.stage_type_snapshot
      into project_id,stage_id,mapping_id,stage_name,stage_type from public.sales_event_items si
      join public.projects p on p.id=original_project and p.deleted_at is null where si.sales_event_id=original_id and si.product_id=gateway.product_id;
    else
      select m.project_id,m.funnel_stage_id,m.id,coalesce(m.funnel_stage_name_snapshot,s.name),coalesce(m.stage_type_snapshot,s.stage_type)
      into project_id,stage_id,mapping_id,stage_name,stage_type from public.product_mappings m
      join public.funnel_stages s on s.id=m.funnel_stage_id and s.archived_at is null
      join public.projects p on p.id=m.project_id and p.deleted_at is null and p.currency=gateway.currency
      join public.products pr on pr.id=m.product_id and pr.archived_at is null
      where m.product_id=gateway.product_id and m.effective_from<=event_time and (m.effective_to is null or m.effective_to>event_time)
      order by m.effective_from desc limit 1;
    end if;
    if project_id is null then mapping_reason:=coalesce(mapping_reason,'product_not_mapped'); continue; end if;
    if event_project is not null and event_project<>project_id then mapping_reason:='items_belong_to_different_projects'; continue; end if;
    event_project:=project_id;
    mapped_items:=mapped_items || jsonb_build_array(i || jsonb_build_object('product_id',product_id,'stage_id',stage_id,'mapping_id',mapping_id,'stage_name',stage_name,'stage_type',stage_type));
  end loop;
  if item_total<>gross or (status in ('paid','refunded','chargeback') and (net is null or net<>item_net or gross<>net+item_fee
    or (p_event #>> '{financial,platform_fee}')::numeric is distinct from item_fee)) then raise exception 'gateway invoice does not reconcile'; end if;
  if mapping_reason is not null then return jsonb_build_object('state','unmapped','mapped',false,'reason',mapping_reason); end if;
  if status in ('paid','refunded','chargeback') then
    select coalesce((payload ->> 'source_updated_at')::timestamptz,event_at) into latest_event_time
    from public.sales_events where connection_id=c.id and external_event_id=c.provider::text || case when status='paid' then ':sale:' else ':reversal:' end || transaction_id for update;
    -- Keep the first accounting date, but do not let an older delivery overwrite newer amounts or tracking.
    if latest_event_time is not null and event_time<latest_event_time then
      return jsonb_build_object('state','processed','mapped',true,'project_id',event_project);
    end if;
  end if;
  email:=nullif(lower(btrim(p_event #>> '{contact,email}')),''); phone:=nullif(regexp_replace(coalesce(p_event #>> '{contact,phone}',''),'[^0-9]','','g'),''); name:=nullif(btrim(p_event #>> '{contact,name}'),'');
  if email is not null and (length(email)>254 or strpos(email,'@')<=1) then email:=null; end if;
  if phone is not null and length(phone) not between 8 and 15 then phone:=null; end if;
  sale_payload:=(p_event - 'transaction_id' - 'occurred_at') || jsonb_build_object('source_updated_at',event_time);
  if email is not null or phone is not null then
    perform pg_advisory_xact_lock(hashtextextended('sale-contact:' || event_project::text,0));
    select id into email_id from public.contacts where project_id=event_project and normalized_email=gateway.email and archived_at is null;
    select id into phone_id from public.contacts where project_id=event_project and normalized_phone=gateway.phone and archived_at is null;
    if email_id is not null and phone_id is not null and email_id<>phone_id then sale_payload:=sale_payload || '{"contact_match_status":"conflict"}';
    else
      contact_id:=coalesce(email_id,phone_id);
      if contact_id is null then insert into public.contacts(organization_id,project_id,name,email,phone,source,first_seen_at,last_seen_at)
        values(c.organization_id,event_project,name,email,phone,c.provider::text,event_time,event_time) returning id into contact_id;
      else update public.contacts set name=coalesce(public.contacts.name,gateway.name),email=coalesce(public.contacts.email,gateway.email),phone=coalesce(public.contacts.phone,gateway.phone),
        first_seen_at=least(first_seen_at,event_time),last_seen_at=greatest(last_seen_at,event_time) where id=contact_id; end if;
    end if;
  end if;
  utm:=coalesce(p_event #> '{attribution,utm}','{}');
  if utm ->> 'source' is not null or utm ->> 'medium' is not null or utm ->> 'campaign' is not null then
    insert into public.utm_campaigns(organization_id,project_id,utm_source,utm_medium,utm_campaign,first_seen_at,last_seen_at)
    values(c.organization_id,event_project,utm ->> 'source',utm ->> 'medium',utm ->> 'campaign',event_time,event_time)
    on conflict(project_id,utm_source,utm_medium,utm_campaign) do update set first_seen_at=least(public.utm_campaigns.first_seen_at,excluded.first_seen_at),last_seen_at=greatest(public.utm_campaigns.last_seen_at,excluded.last_seen_at) returning id into campaign_id;
  end if;
  if status in ('paid','refunded','chargeback') then
    sign:=case when status='paid' then 1 else -1 end;
    insert into public.sales_events(organization_id,project_id,connection_id,external_event_id,external_transaction_id,event_type,event_at,gross_amount,net_amount,currency,payload,processed_at,contact_id)
    values(c.organization_id,event_project,c.id,c.provider::text || case when status='paid' then ':sale:' else ':reversal:' end || transaction_id,transaction_id,
      case when status='paid' then 'PURCHASE_APPROVED' else 'PURCHASE_REFUNDED' end,event_time,sign*gross,sign*net,currency,sale_payload,now(),contact_id)
    on conflict(connection_id,external_event_id) do update set
      payload=case when excluded.event_at>=public.sales_events.event_at then public.merge_payt_sale_payload(public.sales_events.payload,excluded.payload) else public.sales_events.payload end,
      gross_amount=case when excluded.event_at>=public.sales_events.event_at then excluded.gross_amount else public.sales_events.gross_amount end,
      net_amount=case when excluded.event_at>=public.sales_events.event_at then excluded.net_amount else public.sales_events.net_amount end,
      contact_id=coalesce(public.sales_events.contact_id,excluded.contact_id)
    returning id into sale_id;
    for i in select value from jsonb_array_elements(mapped_items) loop
      insert into public.sales_event_items(organization_id,sales_event_id,product_id,funnel_stage_id,product_mapping_id,quantity,gross_amount,net_amount,product_name_snapshot,funnel_stage_name_snapshot,stage_type_snapshot)
      values(c.organization_id,sale_id,(i ->> 'product_id')::uuid,(i ->> 'stage_id')::uuid,(i ->> 'mapping_id')::uuid,1,sign*(i #>> '{financial,gross}')::numeric,sign*(i #>> '{financial,net_after_fees}')::numeric,i ->> 'product_name',i ->> 'stage_name',(i ->> 'stage_type')::public.funnel_stage_type)
      on conflict(sales_event_id,product_id) do update set gross_amount=excluded.gross_amount,net_amount=excluded.net_amount
      where event_time >= (select event_at from public.sales_events where id=sale_id);
    end loop;
    if contact_id is not null and status='paid' then
      insert into public.contact_touchpoints(organization_id,project_id,contact_id,utm_campaign_id,touchpoint_type,occurred_at,utm_term,utm_content,landing_url,external_id,metadata)
      values(c.organization_id,event_project,contact_id,campaign_id,'purchase',event_time,utm ->> 'term',utm ->> 'content',p_event #>> '{attribution,landing_url}',c.provider::text || '-sale:' || sale_id::text,jsonb_build_object('provider',c.provider,'sales_event_id',sale_id))
      on conflict(project_id,external_id) where external_id is not null do update set utm_campaign_id=coalesce(excluded.utm_campaign_id,public.contact_touchpoints.utm_campaign_id) returning id into touch_id;
      insert into public.sales_contact_attributions(organization_id,project_id,sales_event_id,contact_id,touchpoint_id,attributed_amount,attributed_at,metadata)
      values(c.organization_id,event_project,sale_id,contact_id,touch_id,net,event_time,jsonb_build_object('provider',c.provider))
      on conflict(sales_event_id,attribution_model) do update set touchpoint_id=coalesce(excluded.touchpoint_id,public.sales_contact_attributions.touchpoint_id);
    end if;
  end if;
  if status in ('pending','abandoned','failed','expired') then
    insert into public.checkout_recovery_attempts(organization_id,project_id,connection_id,product_id,contact_id,external_kind,external_id,status,amount,currency,offer_external_id,checkout_url,utm_campaign_id,utm_term,utm_content,first_seen_at,last_seen_at,metadata)
    values(c.organization_id,event_project,c.id,(mapped_items #>> '{0,product_id}')::uuid,contact_id,coalesce(p_event ->> 'external_kind','invoice'),transaction_id,status,gross,currency,p_event #>> '{offer,id}',p_event ->> 'checkout_url',campaign_id,utm ->> 'term',utm ->> 'content',event_time,event_time,sale_payload)
    on conflict(connection_id,external_kind,external_id) do update set status=case when public.checkout_recovery_attempts.status='recovered' then 'recovered' else excluded.status end,
      last_seen_at=greatest(public.checkout_recovery_attempts.last_seen_at,excluded.last_seen_at),first_seen_at=least(public.checkout_recovery_attempts.first_seen_at,excluded.first_seen_at),
      contact_id=coalesce(public.checkout_recovery_attempts.contact_id,excluded.contact_id)
    where excluded.last_seen_at>=public.checkout_recovery_attempts.last_seen_at;
    if original_id is not null then update public.checkout_recovery_attempts set status='recovered',recovered_at=original_time,first_seen_at=least(first_seen_at,original_time)
      where connection_id=c.id and external_kind='invoice' and external_id=transaction_id; end if;
  elsif status='paid' then
    update public.checkout_recovery_attempts set status='recovered',recovered_at=greatest(recovered_at,event_time),first_seen_at=least(first_seen_at,event_time),last_seen_at=greatest(last_seen_at,event_time)
    where connection_id=c.id and external_kind='invoice' and external_id=transaction_id;
    -- A lead-only abandonment cannot prove recovery by identity alone; it stays unconfirmed.
  end if;
  update public.integration_connections set status='connected',last_error=null,last_verified_at=now(),metadata=metadata || jsonb_build_object('last_processed_webhook_at',now()) where id=c.id;
  return jsonb_build_object('state','processed','mapped',true,'project_id',event_project);
end;
$$;
revoke all on function public.store_gateway_items(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.store_gateway_items(uuid,jsonb) to service_role;

alter table public.assiny_webhook_receipts drop constraint assiny_webhook_receipts_state_check;
alter table public.assiny_webhook_receipts add constraint assiny_webhook_receipts_state_check check(state in ('awaiting_contract','processed','unmapped','failed','test','ignored'));
alter table public.assiny_webhook_receipts add column normalized_payload jsonb, add column project_id uuid,
  add column review_reason text, add column event_name text, add column processed_at timestamptz, add column last_attempt_at timestamptz;
alter table public.assiny_webhook_receipts add foreign key(organization_id,project_id) references public.projects(organization_id,id) on delete set null(project_id);
create index assiny_receipts_review_idx on public.assiny_webhook_receipts(connection_id,received_at,id) where state in ('awaiting_contract','unmapped','failed');

create function public.get_assiny_webhook_contract(p_connection_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select metadata -> 'assiny_payload_contract' from public.integration_connections where id=p_connection_id and provider='assiny' and revoked_at is null;
$$;
revoke all on function public.get_assiny_webhook_contract(uuid) from public,anon,authenticated;
grant execute on function public.get_assiny_webhook_contract(uuid) to service_role;

create function public.receive_assiny_normalized(p_connection_id uuid,p_token text,p_idempotency_key text,p_payload jsonb,p_normalized jsonb,p_review_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare organization uuid; receipt_id uuid; result jsonb; duplicate boolean:=false; current_state text;
begin
  select organization_id into organization from public.integration_connections where id=p_connection_id and provider='assiny' and revoked_at is null for update;
  if organization is null or public.resolve_assiny_webhook_connection(p_connection_id,p_token) is null then raise exception 'authenticated Assiny connection required'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1000000 then raise exception 'invalid Assiny receipt'; end if;
  insert into public.assiny_webhook_receipts(organization_id,connection_id,idempotency_key,payload,event_name)
    values(organization,p_connection_id,p_idempotency_key,p_payload,left(p_payload ->> 'event',120))
    on conflict(connection_id,idempotency_key) do nothing returning id into receipt_id;
  if receipt_id is null then duplicate:=true; select id,state into receipt_id,current_state from public.assiny_webhook_receipts where connection_id=p_connection_id and idempotency_key=p_idempotency_key for update;
    if current_state in ('processed','test','ignored') then return jsonb_build_object('receipt_id',receipt_id,'duplicate',true,'state',current_state); end if;
  end if;
  update public.assiny_webhook_receipts set normalized_payload=p_normalized,review_reason=p_review_reason,last_attempt_at=now(),event_name=left(p_payload ->> 'event',120) where id=receipt_id;
  if p_normalized is null then result:=jsonb_build_object('state',case when p_review_reason='awaiting_contract' then 'awaiting_contract' when p_review_reason='unsupported_event' then 'ignored' else 'failed' end,'mapped',false);
  else begin result:=public.store_gateway_items(p_connection_id,p_normalized);
    exception when others then result:=jsonb_build_object('state','failed','mapped',false,'reason','processing_failed:' || sqlstate); end;
  end if;
  update public.assiny_webhook_receipts set state=result ->> 'state',project_id=(result ->> 'project_id')::uuid,review_reason=coalesce(result ->> 'reason',p_review_reason),
    processed_at=case when result ->> 'state' in ('processed','test','ignored') then now() else null end where id=receipt_id;
  update public.integration_connections set metadata=metadata || jsonb_build_object('assiny_last_received_at',now(),'last_webhook_at',now(),'last_webhook_event',p_payload ->> 'event') where id=p_connection_id;
  return result || jsonb_build_object('receipt_id',receipt_id,'duplicate',duplicate);
end;
$$;
revoke all on function public.receive_assiny_normalized(uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.receive_assiny_normalized(uuid,text,text,jsonb,jsonb,text) to service_role;

alter function public.process_payt_receipt(uuid) rename to process_payt_receipt_v1;
create function public.process_payt_receipt(p_receipt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.payt_webhook_receipts%rowtype; result jsonb;
begin
  select * into r from public.payt_webhook_receipts where id=p_receipt_id;
  if not found then raise exception 'Payt receipt not found'; end if;
  perform 1 from public.integration_connections where id=r.connection_id and provider='payt' and revoked_at is null for update;
  if not found then raise exception 'active Payt connection required'; end if;
  select * into r from public.payt_webhook_receipts where id=p_receipt_id for update;
  if r.state in ('processed','test') then return jsonb_build_object('state',r.state,'mapped',r.project_id is not null); end if;
  if r.normalized_payload -> 'items' is null then return public.process_payt_receipt_v1(p_receipt_id); end if;
  result:=public.store_gateway_items(r.connection_id,r.normalized_payload);
  update public.payt_webhook_receipts set state=result ->> 'state',project_id=(result ->> 'project_id')::uuid,review_reason=result ->> 'reason',processed_at=case when result ->> 'state' in ('processed','test') then now() else null end where id=p_receipt_id;
  return result;
end;
$$;
revoke all on function public.process_payt_receipt(uuid) from public,anon,authenticated;
grant execute on function public.process_payt_receipt(uuid) to service_role;
