-- Delivery credentials stay in Vault. Only their fingerprints are indexed.
create table public.payt_webhook_routes (
  connection_id uuid primary key references public.integration_connections(id) on delete cascade,
  token_fingerprint bytea not null unique,
  rotated_at timestamptz not null default now()
);
alter table public.payt_webhook_routes enable row level security;
revoke all on public.payt_webhook_routes from public, anon, authenticated;
grant all on public.payt_webhook_routes to service_role;

create table public.payt_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  project_id uuid,
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  event_name text not null default 'postback',
  state text not null check (state in ('awaiting_contract','processed','unmapped','failed','test')),
  review_reason text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  normalized_payload jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_attempt_at timestamptz,
  unique (connection_id, idempotency_key),
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id,id) on delete cascade,
  foreign key (organization_id, project_id) references public.projects(organization_id,id) on delete set null (project_id)
);
create index payt_receipts_connection_received_idx on public.payt_webhook_receipts (connection_id, received_at desc, id);
create index payt_receipts_review_idx on public.payt_webhook_receipts (connection_id, last_attempt_at nulls first, received_at, id) where state <> 'processed';
create index payt_receipts_project_idx on public.payt_webhook_receipts (project_id) where project_id is not null;
alter table public.payt_webhook_receipts enable row level security;
create policy payt_receipts_admin_read on public.payt_webhook_receipts for select to authenticated
using (public.is_org_admin(organization_id));
revoke all on public.payt_webhook_receipts from public, anon, authenticated;
grant select on public.payt_webhook_receipts to authenticated;
grant all on public.payt_webhook_receipts to service_role;

-- This trigger supplements the existing Vault secret writer without changing
-- credential behavior for Hotmart, Hubla, Meta or Google.
create function public.sync_payt_webhook_route()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_connection_id uuid; v_secret jsonb; v_token text;
begin
  v_connection_id := case when tg_op = 'DELETE' then old.connection_id else new.connection_id end;
  if tg_op = 'DELETE' then
    delete from public.payt_webhook_routes where connection_id = v_connection_id;
    return old;
  end if;
  if not exists (select 1 from public.integration_connections where id = v_connection_id and provider = 'payt') then return new; end if;
  select decrypted_secret::jsonb into v_secret from vault.decrypted_secrets where id = new.vault_secret_id;
  v_token := v_secret ->> 'webhookToken';
  if v_secret ->> 'provider' <> 'payt' or v_token is null or v_token !~ '^[a-f0-9]{64}$' then raise exception 'invalid Payt delivery token'; end if;
  insert into public.payt_webhook_routes (connection_id,token_fingerprint,rotated_at)
  values (v_connection_id,extensions.digest(v_token,'sha256'),now())
  on conflict (connection_id) do update set token_fingerprint = excluded.token_fingerprint, rotated_at = excluded.rotated_at;
  update public.integration_connections set metadata = metadata - 'last_webhook_at' - 'last_processed_webhook_at' where id = v_connection_id;
  return new;
end;
$$;
revoke all on function public.sync_payt_webhook_route() from public,anon,authenticated,service_role;
create trigger integration_secrets_sync_payt after insert or update or delete on public.integration_secrets
for each row execute function public.sync_payt_webhook_route();

create function public.resolve_payt_webhook_connection(p_connection_id uuid,p_token text)
returns uuid language sql stable security definer set search_path = '' as $$
  select route.connection_id from public.payt_webhook_routes route
  join public.integration_connections connection on connection.id = route.connection_id
  where route.connection_id = p_connection_id and p_token ~ '^[a-f0-9]{64}$'
    and route.token_fingerprint = extensions.digest(p_token,'sha256')
    and connection.provider = 'payt' and connection.revoked_at is null;
$$;
revoke all on function public.resolve_payt_webhook_connection(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_payt_webhook_connection(uuid,text) to service_role;

create function public.get_payt_webhook_contract(p_connection_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select metadata -> 'payt_payload_contract' from public.integration_connections
  where id = p_connection_id and provider = 'payt' and revoked_at is null;
$$;
revoke all on function public.get_payt_webhook_contract(uuid) from public,anon,authenticated;
grant execute on function public.get_payt_webhook_contract(uuid) to service_role;

-- Project/catalog onboarding must allow configuring Payt before the first sale.
-- Replace the explicit provider lists in the current, hardened definitions.
do $$
declare v_routine regprocedure; v_source text; v_updated text;
begin
  for v_routine in select oid::regprocedure from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('create_project_product_unchecked','create_project_with_funnel')
  loop
    v_source := pg_get_functiondef(v_routine);
    v_updated := replace(v_source,'''hotmart'', ''eduzz'', ''kiwify'', ''hubla''','''hotmart'', ''eduzz'', ''kiwify'', ''hubla'', ''payt''');
    v_updated := replace(v_updated,'connection.status = ''connected''','(connection.status = ''connected'' or (connection.provider = ''payt'' and connection.status = ''attention''))');
    if v_updated = v_source then raise exception 'Payt onboarding preflight failed for %',v_routine; end if;
    execute v_updated;
  end loop;
end;
$$;

create function public.merge_payt_sale_payload(p_old jsonb,p_new jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_result jsonb; v_key text; v_details jsonb;
begin
  v_result := p_old || jsonb_strip_nulls(p_new);
  foreach v_key in array array['financial','contact','offer','payment','attribution'] loop
    v_details := coalesce(p_old -> v_key,'{}'::jsonb) || coalesce((select jsonb_object_agg(k,v)
      from jsonb_each(coalesce(p_new -> v_key,'{}'::jsonb)) x(k,v) where v not in ('null'::jsonb,'""'::jsonb,'{}'::jsonb)), '{}'::jsonb);
    if v_key = 'financial' and p_new #>> '{financial,payout}' is null and p_old #>> '{financial,payout}' is not null then
      v_details := v_details || jsonb_build_object('payout_source',p_old #>> '{financial,payout_source}');
    end if;
    if v_key = 'attribution' then
      v_details := v_details || jsonb_build_object('utm',coalesce(p_old #> '{attribution,utm}','{}'::jsonb) || coalesce(p_new #> '{attribution,utm}','{}'::jsonb));
      v_details := v_details || jsonb_build_object('identifiers',coalesce(p_old #> '{attribution,identifiers}','{}'::jsonb) || coalesce(p_new #> '{attribution,identifiers}','{}'::jsonb));
    end if;
    v_result := jsonb_set(v_result,array[v_key],v_details);
  end loop;
  return v_result;
end;
$$;
revoke all on function public.merge_payt_sale_payload(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.process_payt_receipt(p_receipt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_receipt public.payt_webhook_receipts%rowtype; v_connection public.integration_connections%rowtype;
  v_event jsonb; v_status text; v_transaction text; v_currency text; v_product_id uuid;
  v_project_id uuid; v_stage_id uuid; v_mapping_id uuid; v_stage_name text; v_stage_type public.funnel_stage_type;
  v_product_name text; v_time timestamptz; v_gross numeric; v_net numeric; v_sign integer; v_sale_id uuid;
  v_contact_id uuid; v_email_id uuid; v_phone_id uuid; v_email text; v_phone text; v_name text;
  v_campaign_id uuid; v_utm jsonb; v_payload jsonb; v_last_time timestamptz; v_touch_id uuid;
begin
  select * into v_receipt from public.payt_webhook_receipts where id = p_receipt_id;
  if not found then raise exception 'Payt receipt not found'; end if;
  if v_receipt.state = 'processed' then return jsonb_build_object('state','processed','mapped',v_receipt.project_id is not null); end if;
  select * into v_connection from public.integration_connections where id = v_receipt.connection_id and provider = 'payt' and revoked_at is null for update;
  if not found then raise exception 'active Payt connection not found'; end if;
  select * into v_receipt from public.payt_webhook_receipts where id = p_receipt_id for update;
  if v_receipt.state = 'processed' then return jsonb_build_object('state','processed','mapped',v_receipt.project_id is not null); end if;
  v_event := v_receipt.normalized_payload;
  if v_event is null then return jsonb_build_object('state','awaiting_contract','mapped',false); end if;
  if v_event ->> 'sandbox' = 'true' then
    update public.payt_webhook_receipts set state = 'test', processed_at = now() where id = p_receipt_id;
    return jsonb_build_object('state','test','mapped',false);
  end if;
  v_status := v_event ->> 'status'; v_transaction := v_event ->> 'transaction_id';
  v_currency := v_event ->> 'currency'; v_time := (v_event ->> 'occurred_at')::timestamptz;
  v_gross := (v_event #>> '{financial,gross}')::numeric;
  v_net := coalesce((v_event #>> '{financial,payout}')::numeric,(v_event #>> '{financial,net_after_fees}')::numeric);
  if v_status is null or v_status not in ('paid','refunded','chargeback','pending','abandoned','failed','expired','other')
    or coalesce(length(v_transaction),0) not between 1 and 300 or v_time is null or v_gross is null or v_gross < 0
    or v_currency is null or v_currency !~ '^[A-Z]{3}$' or coalesce(length(v_event ->> 'product_external_id'),0) not between 1 and 300 then raise exception 'invalid normalized Payt event'; end if;
  v_product_name := coalesce(nullif(v_event ->> 'product_name',''),v_event ->> 'product_external_id');
  insert into public.products (organization_id,connection_id,external_id,name,current_price,currency,source,provider_name,provider_price,provider_currency,metadata)
  values (v_receipt.organization_id,v_receipt.connection_id,v_event ->> 'product_external_id',v_product_name,v_gross,v_currency,'provider',v_product_name,v_gross,v_currency,'{"provider":"payt"}'::jsonb)
  on conflict (connection_id,external_id) do update set
    provider_name = excluded.provider_name, provider_price = excluded.provider_price, provider_currency = excluded.provider_currency,
    name = case when public.products.metadata ->> 'manual_override' = 'true' then public.products.name else excluded.name end,
    current_price = case when public.products.metadata ->> 'manual_override' = 'true' then public.products.current_price else excluded.current_price end,
    currency = case when public.products.metadata ->> 'manual_override' = 'true' then public.products.currency else excluded.currency end
  returning id into v_product_id;
  select mapping.project_id,mapping.funnel_stage_id,mapping.id,coalesce(mapping.funnel_stage_name_snapshot,stage.name),coalesce(mapping.stage_type_snapshot,stage.stage_type)
  into v_project_id,v_stage_id,v_mapping_id,v_stage_name,v_stage_type
  from public.product_mappings mapping join public.funnel_stages stage on stage.id = mapping.funnel_stage_id
  join public.projects project on project.id = mapping.project_id
  join public.products product on product.id = mapping.product_id
  where mapping.product_id = v_product_id and mapping.effective_from <= v_time
    and (mapping.effective_to is null or mapping.effective_to > v_time)
    and project.deleted_at is null and stage.archived_at is null and product.archived_at is null
    and project.currency = v_currency order by mapping.effective_from desc limit 1;
  if v_status in ('paid','refunded','chargeback') and exists (select 1 from public.sales_events
    where connection_id = v_receipt.connection_id and external_transaction_id = v_transaction and event_type in ('PURCHASE_APPROVED','PURCHASE_COMPLETED')) then
    select original.project_id,item.funnel_stage_id,item.product_mapping_id,item.funnel_stage_name_snapshot,item.stage_type_snapshot
    into v_project_id,v_stage_id,v_mapping_id,v_stage_name,v_stage_type
    from public.sales_events original join public.sales_event_items item on item.sales_event_id = original.id
    join public.projects project on project.id = original.project_id and project.deleted_at is null
    where original.connection_id = v_receipt.connection_id and original.external_transaction_id = v_transaction
      and original.event_type in ('PURCHASE_APPROVED','PURCHASE_COMPLETED') and original.currency = v_currency and item.product_id = v_product_id limit 1;
  end if;
  if v_project_id is null then
    update public.payt_webhook_receipts set state = 'unmapped',review_reason = 'product_not_mapped' where id = p_receipt_id;
    return jsonb_build_object('state','unmapped','mapped',false);
  end if;
  v_payload := v_event - 'transaction_id' - 'occurred_at';
  v_email := nullif(lower(btrim(v_event #>> '{contact,email}')),'');
  v_phone := nullif(regexp_replace(coalesce(v_event #>> '{contact,phone}',''),'[^0-9]','','g'),'');
  v_name := nullif(btrim(v_event #>> '{contact,name}'),'');
  if v_email is not null and (length(v_email) > 254 or strpos(v_email,'@') <= 1) then v_email := null; end if;
  if v_phone is not null and length(v_phone) not between 8 and 15 then v_phone := null; end if;
  if v_email is not null or v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended('sale-contact:' || v_project_id::text,0));
    select id into v_email_id from public.contacts where project_id = v_project_id and normalized_email = v_email and archived_at is null;
    select id into v_phone_id from public.contacts where project_id = v_project_id and normalized_phone = v_phone and archived_at is null;
    if v_email_id is not null and v_phone_id is not null and v_email_id <> v_phone_id then
      v_payload := v_payload || '{"contact_match_status":"conflict"}'::jsonb;
    else
      v_contact_id := coalesce(v_email_id,v_phone_id);
      if v_contact_id is null then
        insert into public.contacts (organization_id,project_id,name,email,phone,source,first_seen_at,last_seen_at)
        values (v_receipt.organization_id,v_project_id,v_name,v_email,v_phone,'payt',v_time,v_time) returning id into v_contact_id;
      else
        update public.contacts set name = coalesce(name,v_name),email = coalesce(email,v_email),phone = coalesce(phone,v_phone),
          first_seen_at = least(first_seen_at,v_time),last_seen_at = greatest(last_seen_at,v_time) where id = v_contact_id;
      end if;
    end if;
  end if;
  v_utm := coalesce(v_event #> '{attribution,utm}','{}'::jsonb);
  if v_utm ->> 'source' is not null or v_utm ->> 'medium' is not null or v_utm ->> 'campaign' is not null then
    insert into public.utm_campaigns (organization_id,project_id,utm_source,utm_medium,utm_campaign,first_seen_at,last_seen_at)
    values (v_receipt.organization_id,v_project_id,v_utm ->> 'source',v_utm ->> 'medium',v_utm ->> 'campaign',v_time,v_time)
    on conflict (project_id,utm_source,utm_medium,utm_campaign) do update set
      first_seen_at = least(public.utm_campaigns.first_seen_at,excluded.first_seen_at),last_seen_at = greatest(public.utm_campaigns.last_seen_at,excluded.last_seen_at)
    returning id into v_campaign_id;
  end if;
  if v_status in ('paid','refunded','chargeback') then
    if exists (select 1 from public.sales_events where connection_id = v_receipt.connection_id and external_transaction_id = v_transaction
      and (currency <> v_currency or payload ->> 'product_external_id' <> v_event ->> 'product_external_id')) then
      raise exception 'Payt transaction identity changed';
    end if;
    v_sign := case when v_status = 'paid' then 1 else -1 end;
    -- One purchase and one reversal per transaction. Delivery IDs are not sale IDs.
    insert into public.sales_events (organization_id,project_id,connection_id,external_event_id,external_transaction_id,event_type,event_at,gross_amount,net_amount,currency,payload,processed_at,contact_id)
    values (v_receipt.organization_id,v_project_id,v_receipt.connection_id,
      'payt:' || case when v_status = 'paid' then 'sale:' else 'reversal:' end || v_transaction,v_transaction,
      case when v_status = 'paid' then 'PURCHASE_APPROVED' else 'PURCHASE_REFUNDED' end,
      v_time,v_sign * v_gross,v_sign * v_net,v_currency,v_payload,now(),v_contact_id)
    on conflict (connection_id,external_event_id) do update set
      payload = case when excluded.event_at >= public.sales_events.event_at then public.merge_payt_sale_payload(public.sales_events.payload,excluded.payload) else public.sales_events.payload end,
      event_at = greatest(public.sales_events.event_at,excluded.event_at),
      gross_amount = case when excluded.event_at >= public.sales_events.event_at then excluded.gross_amount else public.sales_events.gross_amount end,
      net_amount = case when excluded.event_at >= public.sales_events.event_at then coalesce(excluded.net_amount,public.sales_events.net_amount) else public.sales_events.net_amount end,
      contact_id = coalesce(public.sales_events.contact_id,excluded.contact_id)
    returning id into v_sale_id;
    insert into public.sales_event_items (organization_id,sales_event_id,product_id,funnel_stage_id,product_mapping_id,quantity,gross_amount,net_amount,product_name_snapshot,funnel_stage_name_snapshot,stage_type_snapshot)
    select v_receipt.organization_id,v_sale_id,v_product_id,v_stage_id,v_mapping_id,1,event.gross_amount,event.net_amount,v_product_name,v_stage_name,v_stage_type
    from public.sales_events event where event.id = v_sale_id
    on conflict (sales_event_id,product_id) do update set gross_amount = excluded.gross_amount,net_amount = excluded.net_amount;
    if v_contact_id is not null and v_status = 'paid' then
      insert into public.contact_touchpoints (organization_id,project_id,contact_id,utm_campaign_id,touchpoint_type,occurred_at,utm_term,utm_content,landing_url,external_id,metadata)
      values (v_receipt.organization_id,v_project_id,v_contact_id,v_campaign_id,'purchase',v_time,v_utm ->> 'term',v_utm ->> 'content',v_event #>> '{attribution,landing_url}','payt-sale:' || v_sale_id::text,jsonb_build_object('provider','payt','sales_event_id',v_sale_id))
      on conflict (project_id,external_id) where external_id is not null do update set
        utm_campaign_id = coalesce(excluded.utm_campaign_id,public.contact_touchpoints.utm_campaign_id),
        utm_term = coalesce(excluded.utm_term,public.contact_touchpoints.utm_term),
        utm_content = coalesce(excluded.utm_content,public.contact_touchpoints.utm_content),
        landing_url = coalesce(excluded.landing_url,public.contact_touchpoints.landing_url)
      returning id into v_touch_id;
    end if;
    if v_contact_id is not null then
      if v_touch_id is null then select id into v_touch_id from public.contact_touchpoints where project_id = v_project_id and contact_id = v_contact_id
        and occurred_at <= v_time order by (utm_campaign_id is not null) desc,occurred_at desc,id limit 1; end if;
      insert into public.sales_contact_attributions (organization_id,project_id,sales_event_id,contact_id,touchpoint_id,attributed_amount,attributed_at,metadata)
      select v_receipt.organization_id,v_project_id,v_sale_id,v_contact_id,v_touch_id,coalesce(event.net_amount,0),v_time,'{"provider":"payt"}'::jsonb from public.sales_events event where event.id = v_sale_id
      on conflict (sales_event_id,attribution_model) do update set touchpoint_id = coalesce(excluded.touchpoint_id,public.sales_contact_attributions.touchpoint_id),attributed_amount = excluded.attributed_amount;
    end if;
  end if;
  if v_status in ('pending','abandoned','failed','expired') then
    insert into public.checkout_recovery_attempts (organization_id,project_id,connection_id,product_id,contact_id,external_kind,external_id,status,amount,currency,offer_external_id,checkout_url,utm_campaign_id,utm_term,utm_content,first_seen_at,last_seen_at,metadata)
    values (v_receipt.organization_id,v_project_id,v_receipt.connection_id,v_product_id,v_contact_id,'invoice',v_transaction,v_status,v_gross,v_currency,v_event #>> '{offer,id}',v_event #>> '{attribution,landing_url}',v_campaign_id,v_utm ->> 'term',v_utm ->> 'content',v_time,v_time,v_payload)
    on conflict (connection_id,external_kind,external_id) do update set
      status = case when public.checkout_recovery_attempts.status = 'recovered' then 'recovered' else excluded.status end,
      last_seen_at = greatest(public.checkout_recovery_attempts.last_seen_at,excluded.last_seen_at),
      first_seen_at = least(public.checkout_recovery_attempts.first_seen_at,excluded.first_seen_at),
      contact_id = coalesce(public.checkout_recovery_attempts.contact_id,excluded.contact_id)
    where excluded.last_seen_at >= public.checkout_recovery_attempts.last_seen_at;
    -- Pending events can arrive after the corresponding approved sale.
    select event_at into v_last_time from public.sales_events where connection_id = v_receipt.connection_id and external_transaction_id = v_transaction and event_type in ('PURCHASE_APPROVED','PURCHASE_COMPLETED');
    if v_last_time is not null then
      update public.checkout_recovery_attempts set status = 'recovered',recovered_at = v_last_time,first_seen_at = least(first_seen_at,v_last_time)
      where connection_id = v_receipt.connection_id and external_id = v_transaction and external_kind = 'invoice';
    end if;
  elsif v_status = 'paid' then
    select event_at into v_last_time from public.sales_events where id = v_sale_id;
    update public.checkout_recovery_attempts set status = 'recovered',recovered_at = greatest(recovered_at,v_last_time),
      first_seen_at = least(first_seen_at,v_last_time),last_seen_at = greatest(last_seen_at,v_last_time)
    where connection_id = v_receipt.connection_id and external_kind = 'invoice' and external_id = v_transaction;
  end if;
  update public.payt_webhook_receipts set state = 'processed',project_id = v_project_id,processed_at = now(),review_reason = null where id = p_receipt_id;
  update public.integration_connections set status = 'connected',last_verified_at = now(),last_error = null,
    metadata = metadata || jsonb_build_object('last_processed_webhook_at',now()) where id = v_receipt.connection_id;
  return jsonb_build_object('state','processed','mapped',true);
end;
$$;
revoke all on function public.process_payt_receipt(uuid) from public,anon,authenticated;
grant execute on function public.process_payt_receipt(uuid) to service_role;

create function public.receive_payt_postback(p_connection_id uuid,p_idempotency_key text,p_payload jsonb,p_normalized jsonb default null,p_review_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_organization_id uuid; v_receipt_id uuid; v_result jsonb; v_duplicate boolean := false; v_name text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 1200000
    or p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid Payt postback'; end if;
  select organization_id into v_organization_id from public.integration_connections where id = p_connection_id and provider = 'payt' and revoked_at is null for update;
  if not found then raise exception 'active Payt connection not found'; end if;
  v_name := left(coalesce(nullif(p_payload ->> 'event',''),nullif(p_payload ->> 'event_type',''),nullif(p_payload ->> 'type',''),nullif(p_payload ->> 'status',''),'postback'),120);
  insert into public.payt_webhook_receipts (organization_id,connection_id,idempotency_key,event_name,state,review_reason,payload,normalized_payload)
  values (v_organization_id,p_connection_id,p_idempotency_key,v_name,'awaiting_contract',p_review_reason,p_payload,p_normalized)
  on conflict (connection_id,idempotency_key) do nothing returning id into v_receipt_id;
  if v_receipt_id is null then
    v_duplicate := true;
    select id into v_receipt_id from public.payt_webhook_receipts where connection_id = p_connection_id and idempotency_key = p_idempotency_key;
    update public.payt_webhook_receipts set normalized_payload = p_normalized,review_reason = p_review_reason,
      state = case when p_normalized is null then 'awaiting_contract' else state end
    where id = v_receipt_id and state not in ('processed','test');
  end if;
  update public.integration_connections set metadata = metadata || jsonb_build_object('last_webhook_at',now(),'last_webhook_event',v_name) where id = p_connection_id;
  update public.payt_webhook_receipts set last_attempt_at = now() where id = v_receipt_id;
  begin
    v_result := public.process_payt_receipt(v_receipt_id);
  exception when others then
    update public.payt_webhook_receipts set state = 'failed',review_reason = 'processing_failed:' || sqlstate where id = v_receipt_id;
    v_result := jsonb_build_object('state','failed','mapped',false);
  end;
  return v_result || jsonb_build_object('duplicate',v_duplicate,'receipt_id',v_receipt_id);
end;
$$;
revoke all on function public.receive_payt_postback(uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.receive_payt_postback(uuid,text,jsonb,jsonb,text) to service_role;
