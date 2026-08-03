drop policy if exists hubla_webhook_events_read
on public.hubla_webhook_events;

create policy hubla_webhook_events_admin_read
on public.hubla_webhook_events for select to authenticated
using (public.is_org_admin(organization_id));

update public.hubla_webhook_events
set payload = pg_catalog.jsonb_strip_nulls(
  pg_catalog.jsonb_build_object(
    'type', event_type,
    'contract_version', contract_version,
    'entity_id', entity_id,
    'entity_version', entity_version,
    'product_id', product_id
  )
);

create or replace function public.ingest_hubla_webhook(
  p_connection_id uuid,
  p_idempotency_key text,
  p_event_type text,
  p_contract_version text,
  p_event_at timestamptz,
  p_entity_id text,
  p_entity_version bigint,
  p_product_external_id text,
  p_product_name text,
  p_gross_amount numeric,
  p_net_amount numeric,
  p_currency text,
  p_sandbox boolean,
  p_payload jsonb
)
returns table(duplicate boolean, mapped boolean, normalized boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_raw_event_id uuid;
  v_product_id uuid;
  v_project_id uuid;
  v_stage_id uuid;
  v_mapping_id uuid;
  v_stage_name text;
  v_stage_type public.funnel_stage_type;
  v_original_product_id uuid;
  v_original_project_id uuid;
  v_original_stage_id uuid;
  v_original_mapping_id uuid;
  v_original_product_name text;
  v_original_stage_name text;
  v_original_stage_type public.funnel_stage_type;
  v_sales_event_id uuid;
  v_normalized_type text;
  v_sign numeric := 1;
  v_product_name text;
  v_currency text;
begin
  if p_idempotency_key is null
    or pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) not between 1 and 200
    or p_event_type is null
    or pg_catalog.length(pg_catalog.btrim(p_event_type)) not between 1 and 120
    or p_event_at is null
    or p_payload is null
    or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or coalesce(p_gross_amount, 0) < 0
    or coalesce(p_net_amount, 0) < 0 then
    raise exception 'invalid Hubla event';
  end if;

  select connection.organization_id
  into v_organization_id
  from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.provider = 'hubla'
    and connection.revoked_at is null
  for update;
  if v_organization_id is null then
    raise exception 'active Hubla connection not found';
  end if;

  insert into public.hubla_webhook_events (
    organization_id, connection_id, idempotency_key, event_type,
    contract_version, entity_id, entity_version, event_at, sandbox, payload
  )
  values (
    v_organization_id, p_connection_id, pg_catalog.btrim(p_idempotency_key),
    pg_catalog.btrim(p_event_type), p_contract_version, p_entity_id,
    p_entity_version, p_event_at, coalesce(p_sandbox, false),
    pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object(
        'type', pg_catalog.btrim(p_event_type),
        'contract_version', p_contract_version,
        'entity_id', p_entity_id,
        'entity_version', p_entity_version,
        'product_external_id', p_product_external_id,
        'product_name', p_product_name
      )
    )
  )
  on conflict (connection_id, idempotency_key) do nothing
  returning id into v_raw_event_id;

  if v_raw_event_id is null then
    return query select true, false, false;
    return;
  end if;

  update public.integration_connections connection
  set status = 'connected',
      last_verified_at = now(),
      last_error = null,
      metadata = connection.metadata || pg_catalog.jsonb_build_object(
        'last_webhook_at', now(),
        'last_webhook_event', p_event_type
      )
  where connection.id = p_connection_id;

  if coalesce(p_sandbox, false) then
    update public.hubla_webhook_events
    set processed_at = now()
    where id = v_raw_event_id;
    return query select false, false, false;
    return;
  end if;

  if nullif(pg_catalog.btrim(p_product_external_id), '') is not null then
    v_product_name := coalesce(
      nullif(pg_catalog.btrim(p_product_name), ''),
      pg_catalog.btrim(p_product_external_id)
    );
    v_currency := coalesce(nullif(pg_catalog.upper(pg_catalog.btrim(p_currency)), ''), 'BRL');

    insert into public.products (
      organization_id, connection_id, external_id, name, current_price,
      currency, is_active, source, provider_name, provider_price,
      provider_currency, metadata
    )
    values (
      v_organization_id, p_connection_id, pg_catalog.btrim(p_product_external_id),
      v_product_name, coalesce(p_gross_amount, 0), v_currency, true, 'provider',
      v_product_name, coalesce(p_gross_amount, 0), v_currency,
      pg_catalog.jsonb_build_object('provider', 'hubla')
    )
    on conflict (connection_id, external_id) do update
    set provider_name = excluded.provider_name,
        provider_price = excluded.provider_price,
        provider_currency = excluded.provider_currency,
        name = case
          when public.products.metadata ->> 'manual_override' = 'true'
            then public.products.name
          else excluded.name
        end,
        current_price = case
          when public.products.metadata ->> 'manual_override' = 'true'
            then public.products.current_price
          else excluded.current_price
        end,
        currency = case
          when public.products.metadata ->> 'manual_override' = 'true'
            then public.products.currency
          else excluded.currency
        end,
        is_active = true,
        archived_at = null,
        updated_at = now()
    returning id into v_product_id;

    select mapping.project_id, mapping.funnel_stage_id, mapping.id,
           coalesce(mapping.funnel_stage_name_snapshot, stage.name),
           coalesce(mapping.stage_type_snapshot, stage.stage_type)
    into v_project_id, v_stage_id, v_mapping_id, v_stage_name, v_stage_type
    from public.product_mappings mapping
    join public.funnel_stages stage on stage.id = mapping.funnel_stage_id
    where mapping.product_id = v_product_id
      and mapping.effective_from <= p_event_at
      and (mapping.effective_to is null or mapping.effective_to > p_event_at)
    order by mapping.effective_from desc
    limit 1;
  end if;

  if p_event_type = 'invoice.refunded'
    and nullif(pg_catalog.btrim(p_entity_id), '') is not null then
    select original.project_id, item.product_id, item.funnel_stage_id,
           item.product_mapping_id, item.product_name_snapshot,
           item.funnel_stage_name_snapshot, item.stage_type_snapshot
    into v_original_project_id, v_original_product_id, v_original_stage_id,
         v_original_mapping_id, v_original_product_name,
         v_original_stage_name, v_original_stage_type
    from public.sales_events original
    left join public.sales_event_items item
      on item.sales_event_id = original.id
    where original.connection_id = p_connection_id
      and original.external_transaction_id = pg_catalog.btrim(p_entity_id)
      and original.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED')
    order by original.event_at, item.created_at
    limit 1;

    if found then
      v_project_id := v_original_project_id;
      v_product_id := v_original_product_id;
      v_stage_id := v_original_stage_id;
      v_mapping_id := v_original_mapping_id;
      v_product_name := v_original_product_name;
      v_stage_name := v_original_stage_name;
      v_stage_type := v_original_stage_type;
    end if;
  end if;

  update public.hubla_webhook_events
  set project_id = v_project_id,
      product_id = v_product_id
  where id = v_raw_event_id;

  if p_event_type = 'invoice.payment_succeeded' then
    v_normalized_type := 'PURCHASE_COMPLETED';
  elsif p_event_type = 'invoice.refunded' then
    v_normalized_type := 'PURCHASE_REFUNDED';
    v_sign := -1;
  else
    update public.hubla_webhook_events
    set processed_at = now()
    where id = v_raw_event_id;
    return query select false, v_project_id is not null, false;
    return;
  end if;

  insert into public.sales_events (
    organization_id, project_id, connection_id, external_event_id,
    external_transaction_id, event_type, event_at, gross_amount,
    net_amount, currency, payload, processed_at
  )
  values (
    v_organization_id, v_project_id, p_connection_id,
    pg_catalog.btrim(p_idempotency_key), p_entity_id, v_normalized_type,
    p_event_at, v_sign * coalesce(p_gross_amount, 0),
    v_sign * coalesce(p_net_amount, p_gross_amount, 0),
    coalesce(nullif(pg_catalog.upper(pg_catalog.btrim(p_currency)), ''), 'BRL'),
    pg_catalog.jsonb_build_object(
      'provider', 'hubla',
      'product_external_id', p_product_external_id,
      'hubla_event_type', p_event_type,
      'entity_version', p_entity_version
    ),
    case when v_project_id is not null then now() else null end
  )
  returning id into v_sales_event_id;

  if v_project_id is not null and v_product_id is not null then
    insert into public.sales_event_items (
      organization_id, sales_event_id, product_id, funnel_stage_id,
      product_mapping_id, quantity, gross_amount, net_amount,
      product_name_snapshot, funnel_stage_name_snapshot, stage_type_snapshot
    )
    values (
      v_organization_id, v_sales_event_id, v_product_id, v_stage_id,
      v_mapping_id, 1, v_sign * coalesce(p_gross_amount, 0),
      v_sign * coalesce(p_net_amount, p_gross_amount, 0),
      v_product_name, v_stage_name, v_stage_type
    );
  end if;

  update public.hubla_webhook_events
  set processed_at = case when v_project_id is not null then now() else null end,
      error_message = case when v_project_id is null then 'product not mapped' else null end
  where id = v_raw_event_id;

  return query select false, v_project_id is not null, true;
end;
$$;
