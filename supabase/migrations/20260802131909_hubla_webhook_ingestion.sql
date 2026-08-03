create table public.hubla_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  project_id uuid,
  product_id uuid,
  idempotency_key text not null,
  event_type text not null,
  contract_version text,
  entity_id text,
  entity_version bigint,
  event_at timestamptz not null,
  sandbox boolean not null default false,
  payload jsonb not null,
  processed_at timestamptz,
  error_message text,
  received_at timestamptz not null default now(),
  unique (connection_id, idempotency_key),
  foreign key (organization_id, connection_id)
    references public.integration_connections(organization_id, id)
    on delete cascade,
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete set null (project_id),
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
    on delete set null (product_id)
);

create index hubla_webhook_events_connection_received_idx
  on public.hubla_webhook_events (connection_id, received_at desc);
create index hubla_webhook_events_project_event_idx
  on public.hubla_webhook_events (project_id, event_at desc);

alter table public.hubla_webhook_events enable row level security;

create policy hubla_webhook_events_read
on public.hubla_webhook_events for select to authenticated
using (public.is_org_member(organization_id));

revoke insert, update, delete on public.hubla_webhook_events from authenticated;
grant select on public.hubla_webhook_events to authenticated;
grant all on public.hubla_webhook_events to service_role;

create or replace function public.create_hubla_webhook_connection(
  p_organization_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(p_name)) not between 2 and 120 then
    raise exception 'invalid connection name';
  end if;

  insert into public.integration_connections (
    organization_id, name, provider, status, metadata
  )
  values (
    p_organization_id, pg_catalog.btrim(p_name), 'hubla', 'disconnected',
    pg_catalog.jsonb_build_object('webhook_endpoint_generated_at', now())
  )
  returning id into v_connection_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(), 'hubla.endpoint_created',
    'integration_connection', v_connection_id::text, '{}'::jsonb
  );

  return pg_catalog.jsonb_build_object(
    'id', v_connection_id,
    'name', pg_catalog.btrim(p_name),
    'provider', 'hubla',
    'status', 'disconnected'
  );
end;
$$;

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
    p_entity_version, p_event_at, coalesce(p_sandbox, false), p_payload
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

create or replace view public.project_daily_metrics
with (security_invoker = true)
as
with traffic as (
  select
    organization_id,
    project_id,
    metric_date,
    pg_catalog.sum(investment) as investment,
    pg_catalog.sum(impressions) as impressions,
    pg_catalog.sum(clicks) as clicks,
    pg_catalog.sum(page_views) as page_views,
    pg_catalog.sum(checkouts) as checkouts
  from public.traffic_metrics_daily
  group by organization_id, project_id, metric_date
),
sales_per_event as (
  select
    event.id,
    event.organization_id,
    event.project_id,
    (event.event_at at time zone project.reporting_timezone)::date as metric_date,
    event.net_amount,
    coalesce(
      pg_catalog.sum(
        case
          when coalesce(item.stage_type_snapshot, stage.stage_type) = 'core'
            then case when event.event_type = 'PURCHASE_REFUNDED'
              then -item.quantity else item.quantity end
          else 0
        end
      ),
      0
    ) as core_sales
  from public.sales_events event
  join public.projects project on project.id = event.project_id
  left join public.sales_event_items item on item.sales_event_id = event.id
  left join public.funnel_stages stage on stage.id = item.funnel_stage_id
  where event.project_id is not null
    and event.event_type in (
      'PURCHASE_APPROVED', 'PURCHASE_COMPLETED', 'PURCHASE_REFUNDED'
    )
  group by event.id, project.reporting_timezone
),
sales as (
  select
    organization_id,
    project_id,
    metric_date,
    pg_catalog.sum(net_amount) as revenue,
    pg_catalog.sum(core_sales) as core_sales
  from sales_per_event
  group by organization_id, project_id, metric_date
)
select
  coalesce(traffic.organization_id, sales.organization_id) as organization_id,
  coalesce(traffic.project_id, sales.project_id) as project_id,
  coalesce(traffic.metric_date, sales.metric_date) as metric_date,
  coalesce(traffic.investment, 0) as investment,
  coalesce(sales.revenue, 0) as revenue,
  coalesce(traffic.impressions, 0) as impressions,
  coalesce(traffic.clicks, 0) as clicks,
  coalesce(traffic.page_views, 0) as page_views,
  coalesce(traffic.checkouts, 0) as checkouts,
  coalesce(sales.core_sales, 0) as core_sales
from traffic
full join sales
  on sales.organization_id = traffic.organization_id
  and sales.project_id = traffic.project_id
  and sales.metric_date = traffic.metric_date;

revoke all on function public.create_hubla_webhook_connection(uuid, text)
  from public, anon;
grant execute on function public.create_hubla_webhook_connection(uuid, text)
  to authenticated;

revoke all on function public.ingest_hubla_webhook(
  uuid, text, text, text, timestamptz, text, bigint, text, text,
  numeric, numeric, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_hubla_webhook(
  uuid, text, text, text, timestamptz, text, bigint, text, text,
  numeric, numeric, text, boolean, jsonb
) to service_role;
