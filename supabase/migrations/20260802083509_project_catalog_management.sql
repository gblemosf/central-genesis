alter table public.products
  alter column connection_id drop not null,
  add column source text not null default 'provider'
    check (source in ('provider', 'manual')),
  add column archived_at timestamptz,
  add column provider_name text,
  add column provider_price numeric(14,2),
  add column provider_currency text;

update public.products
set provider_name = name,
    provider_price = current_price,
    provider_currency = currency
where connection_id is not null;

update public.products
set archived_at = coalesce(updated_at, now())
where not is_active;

alter table public.products
  add constraint products_source_connection_check
  check (source = 'manual' or connection_id is not null);

create unique index products_manual_external_id_unique
  on public.products (organization_id, external_id)
  where connection_id is null;

alter table public.funnel_stages
  add column archived_at timestamptz;

alter table public.funnel_stages
  drop constraint funnel_stages_project_id_position_key;

create unique index funnel_stages_active_position_unique
  on public.funnel_stages (project_id, position)
  where archived_at is null;

alter table public.product_mappings
  add column funnel_stage_name_snapshot text,
  add column stage_type_snapshot public.funnel_stage_type;

update public.product_mappings mapping
set funnel_stage_name_snapshot = stage.name,
    stage_type_snapshot = stage.stage_type
from public.funnel_stages stage
where stage.id = mapping.funnel_stage_id;

alter table public.sales_event_items
  add column product_mapping_id uuid references public.product_mappings(id) on delete set null,
  add column product_name_snapshot text,
  add column funnel_stage_name_snapshot text,
  add column stage_type_snapshot public.funnel_stage_type;

update public.sales_event_items item
set product_name_snapshot = product.name,
    funnel_stage_name_snapshot = stage.name,
    stage_type_snapshot = stage.stage_type
from public.products product, public.funnel_stages stage
where product.id = item.product_id
  and stage.id = item.funnel_stage_id;

update public.sales_event_items item
set product_mapping_id = (
  select mapping.id
  from public.sales_events event
  join public.product_mappings mapping
    on mapping.product_id = item.product_id
    and mapping.funnel_stage_id = item.funnel_stage_id
    and mapping.effective_from <= event.event_at
    and (mapping.effective_to is null or mapping.effective_to > event.event_at)
  where event.id = item.sales_event_id
  order by mapping.effective_from desc
  limit 1
);

create index product_mappings_project_active_idx
  on public.product_mappings (project_id, effective_to);

create index product_mappings_stage_active_idx
  on public.product_mappings (funnel_stage_id, effective_to);

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
      pg_catalog.sum(item.quantity) filter (
        where coalesce(item.stage_type_snapshot, stage.stage_type) = 'core'
      ),
      0
    ) as core_sales
  from public.sales_events event
  join public.projects project on project.id = event.project_id
  left join public.sales_event_items item on item.sales_event_id = event.id
  left join public.funnel_stages stage on stage.id = item.funnel_stage_id
  where event.project_id is not null
    and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED')
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

create or replace function public.create_project_funnel_stage(
  p_organization_id uuid,
  p_project_id uuid,
  p_name text,
  p_stage_type public.funnel_stage_type,
  p_color text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage_id uuid;
  v_position integer;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(p_name)) < 2 then
    raise exception 'invalid funnel stage name';
  end if;

  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'project not found';
  end if;

  select coalesce(pg_catalog.max(stage.position), 0) + 1
  into v_position
  from public.funnel_stages stage
  where stage.project_id = p_project_id
    and stage.archived_at is null;

  insert into public.funnel_stages (
    organization_id, project_id, name, stage_type, position, color
  )
  values (
    p_organization_id, p_project_id, pg_catalog.btrim(p_name),
    p_stage_type, v_position, p_color
  )
  returning id into v_stage_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(), 'funnel_stage.created', 'funnel_stage',
    v_stage_id::text,
    pg_catalog.jsonb_build_object('project_id', p_project_id, 'position', v_position)
  );

  return v_stage_id;
end;
$$;

create or replace function public.update_project_funnel_stage(
  p_organization_id uuid,
  p_project_id uuid,
  p_stage_id uuid,
  p_name text,
  p_stage_type public.funnel_stage_type,
  p_color text,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_mapping record;
  v_archived_at timestamptz;
  v_position integer;
  v_current_name text;
  v_current_type public.funnel_stage_type;
  v_transition_at timestamptz;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  if p_archived is null then
    raise exception 'archived state is required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(p_name)) < 2 then
    raise exception 'invalid funnel stage name';
  end if;

  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'project not found';
  end if;

  select stage.archived_at, stage.position, stage.name, stage.stage_type
  into v_archived_at, v_position, v_current_name, v_current_type
  from public.funnel_stages stage
  where stage.id = p_stage_id
    and stage.organization_id = p_organization_id
    and stage.project_id = p_project_id
  for update;
  if not found then
    raise exception 'funnel stage not found';
  end if;

  if v_archived_at is null and (
    p_archived
    or pg_catalog.btrim(p_name) is distinct from v_current_name
    or p_stage_type is distinct from v_current_type
  ) then
    perform product.id
    from public.products product
    join public.product_mappings mapping on mapping.product_id = product.id
    where mapping.funnel_stage_id = p_stage_id
      and mapping.effective_to is null
    order by product.id
    for update of product;
  end if;

  if p_archived and v_archived_at is null then
    update public.product_mappings mapping
    set effective_to = greatest(
      pg_catalog.clock_timestamp(),
      mapping.effective_from + interval '1 microsecond'
    )
    where mapping.organization_id = p_organization_id
      and mapping.funnel_stage_id = p_stage_id
      and mapping.effective_to is null;
    v_archived_at := now();
  elsif not p_archived and v_archived_at is null and (
    pg_catalog.btrim(p_name) is distinct from v_current_name
    or p_stage_type is distinct from v_current_type
  ) then
    for active_mapping in
      select mapping.id, mapping.organization_id, mapping.project_id,
             mapping.product_id, mapping.effective_from
      from public.product_mappings mapping
      where mapping.funnel_stage_id = p_stage_id
        and mapping.effective_to is null
      order by mapping.product_id
      for update
    loop
      v_transition_at := greatest(
        pg_catalog.clock_timestamp(),
        active_mapping.effective_from + interval '1 microsecond'
      );
      update public.product_mappings
      set effective_to = v_transition_at
      where id = active_mapping.id;

      insert into public.product_mappings (
        organization_id, project_id, product_id, funnel_stage_id,
        effective_from, created_by, funnel_stage_name_snapshot, stage_type_snapshot
      )
      values (
        active_mapping.organization_id, active_mapping.project_id,
        active_mapping.product_id, p_stage_id, v_transition_at, auth.uid(),
        pg_catalog.btrim(p_name), p_stage_type
      );
    end loop;
  elsif not p_archived and v_archived_at is not null then
    select coalesce(pg_catalog.max(stage.position), 0) + 1
    into v_position
    from public.funnel_stages stage
    where stage.project_id = p_project_id
      and stage.archived_at is null;
    v_archived_at := null;
  end if;

  update public.funnel_stages stage
  set name = pg_catalog.btrim(p_name),
      stage_type = p_stage_type,
      color = p_color,
      position = v_position,
      archived_at = v_archived_at
  where stage.id = p_stage_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(),
    case when p_archived then 'funnel_stage.archived' else 'funnel_stage.updated' end,
    'funnel_stage', p_stage_id::text,
    pg_catalog.jsonb_build_object('project_id', p_project_id)
  );
end;
$$;

create or replace function public.delete_empty_integration_connection(
  p_organization_id uuid,
  p_connection_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;

  perform 1
  from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.organization_id = p_organization_id
    and connection.status = 'revoked'
  for update;
  if not found then
    raise exception 'revoked connection not found';
  end if;

  if exists (
    select 1
    from public.project_accounts link
    join public.provider_accounts account on account.id = link.provider_account_id
    where account.connection_id = p_connection_id
  ) or exists (
    select 1 from public.products product
    where product.connection_id = p_connection_id
  ) or exists (
    select 1 from public.sales_events event
    where event.connection_id = p_connection_id
  ) or exists (
    select 1
    from public.traffic_metrics_daily metric
    join public.provider_accounts account on account.id = metric.provider_account_id
    where account.connection_id = p_connection_id
  ) or exists (
    select 1 from public.sync_runs run
    where run.connection_id = p_connection_id
  ) then
    raise exception 'connection has historical data';
  end if;

  delete from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.organization_id = p_organization_id;
end;
$$;

create or replace function public.reorder_project_funnel_stages(
  p_organization_id uuid,
  p_project_id uuid,
  p_stage_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
  v_requested_count integer;
  v_distinct_count integer;
  v_offset integer;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'project not found';
  end if;

  select pg_catalog.count(*)
  into v_active_count
  from public.funnel_stages stage
  where stage.project_id = p_project_id
    and stage.archived_at is null;

  select pg_catalog.count(*), pg_catalog.count(distinct requested.stage_id)
  into v_requested_count, v_distinct_count
  from pg_catalog.unnest(coalesce(p_stage_ids, array[]::uuid[])) requested(stage_id);

  if v_requested_count <> v_active_count
    or v_distinct_count <> v_requested_count
    or exists (
      select 1
      from pg_catalog.unnest(coalesce(p_stage_ids, array[]::uuid[])) requested(stage_id)
      left join public.funnel_stages stage
        on stage.id = requested.stage_id
        and stage.organization_id = p_organization_id
        and stage.project_id = p_project_id
        and stage.archived_at is null
      where stage.id is null
    ) then
    raise exception 'stage order must contain every active stage exactly once';
  end if;

  select coalesce(pg_catalog.max(stage.position), 0) + v_active_count + 1000
  into v_offset
  from public.funnel_stages stage
  where stage.project_id = p_project_id
    and stage.archived_at is null;

  update public.funnel_stages stage
  set position = stage.position + v_offset
  where stage.project_id = p_project_id
    and stage.archived_at is null;

  update public.funnel_stages stage
  set position = requested.position::integer
  from pg_catalog.unnest(p_stage_ids) with ordinality requested(stage_id, position)
  where stage.id = requested.stage_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(), 'funnel_stage.reordered', 'project',
    p_project_id::text,
    pg_catalog.jsonb_build_object('stage_ids', pg_catalog.to_jsonb(p_stage_ids))
  );
end;
$$;

create or replace function public.create_project_product(
  p_organization_id uuid,
  p_project_id uuid,
  p_connection_id uuid,
  p_external_id text,
  p_name text,
  p_current_price numeric,
  p_currency text,
  p_funnel_stage_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_project_currency text;
  v_mapping_id uuid;
  v_stage_name text;
  v_stage_type public.funnel_stage_type;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(p_name)) < 2
    or pg_catalog.length(pg_catalog.btrim(p_external_id)) < 1
    or p_current_price is null
    or p_current_price < 0 then
    raise exception 'invalid product data';
  end if;

  select project.currency into v_project_currency
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if v_project_currency is null then
    raise exception 'project not found';
  end if;
  if pg_catalog.upper(p_currency) <> v_project_currency then
    raise exception 'product currency does not match project currency';
  end if;
  if p_connection_id is not null and not exists (
    select 1
    from public.integration_connections connection
    where connection.id = p_connection_id
      and connection.organization_id = p_organization_id
      and connection.provider = 'hotmart'
      and connection.revoked_at is null
  ) then
    raise exception 'active Hotmart connection not found';
  end if;
  if p_funnel_stage_id is not null then
    select stage.name, stage.stage_type
    into v_stage_name, v_stage_type
    from public.funnel_stages stage
    where stage.id = p_funnel_stage_id
      and stage.organization_id = p_organization_id
      and stage.project_id = p_project_id
      and stage.archived_at is null;
    if not found then
      raise exception 'active funnel stage not found';
    end if;
  end if;

  insert into public.products (
    organization_id, connection_id, external_id, name, current_price,
    currency, source, metadata
  )
  values (
    p_organization_id, p_connection_id, pg_catalog.btrim(p_external_id),
    pg_catalog.btrim(p_name), p_current_price, v_project_currency, 'manual',
    pg_catalog.jsonb_build_object('manual_override', true)
  )
  returning id into v_product_id;

  if p_funnel_stage_id is not null then
    insert into public.product_mappings (
      organization_id, project_id, product_id, funnel_stage_id,
      effective_from, created_by, funnel_stage_name_snapshot, stage_type_snapshot
    )
    values (
      p_organization_id, p_project_id, v_product_id, p_funnel_stage_id,
      pg_catalog.to_timestamp(0), auth.uid(), v_stage_name, v_stage_type
    )
    returning id into v_mapping_id;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(), 'product.created', 'product', v_product_id::text,
    pg_catalog.jsonb_build_object(
      'project_id', p_project_id,
      'mapping_id', v_mapping_id,
      'source', 'manual'
    )
  );

  return v_product_id;
end;
$$;

create or replace function public.update_project_product(
  p_organization_id uuid,
  p_project_id uuid,
  p_product_id uuid,
  p_external_id text,
  p_name text,
  p_current_price numeric,
  p_currency text,
  p_funnel_stage_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_event record;
  v_connection_id uuid;
  v_project_currency text;
  v_current_mapping_id uuid;
  v_current_project_id uuid;
  v_current_stage_id uuid;
  v_effective_from timestamptz;
  v_transition_at timestamptz;
  v_has_history boolean;
  v_mapping_id uuid;
  v_stage_name text;
  v_stage_type public.funnel_stage_type;
  v_mapping_stage_name text;
  v_mapping_stage_type public.funnel_stage_type;
  v_current_external_id text;
  v_provider_name text;
  v_provider_price numeric;
  v_provider_currency text;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(p_name)) < 2
    or pg_catalog.length(pg_catalog.btrim(p_external_id)) < 1
    or p_current_price is null
    or p_current_price < 0 then
    raise exception 'invalid product data';
  end if;

  select project.currency into v_project_currency
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if v_project_currency is null then
    raise exception 'project not found';
  end if;
  if pg_catalog.upper(p_currency) <> v_project_currency then
    raise exception 'product currency does not match project currency';
  end if;

  select product.connection_id, product.external_id, product.provider_name,
         product.provider_price, product.provider_currency
  into v_connection_id, v_current_external_id, v_provider_name,
       v_provider_price, v_provider_currency
  from public.products product
  where product.id = p_product_id
    and product.organization_id = p_organization_id
    and product.archived_at is null
  for update;
  if not found then
    raise exception 'active product not found';
  end if;
  if v_connection_id is not null
    and pg_catalog.btrim(p_external_id) <> v_current_external_id then
    raise exception 'provider product identifier cannot be changed';
  end if;

  update public.products product
  set external_id = pg_catalog.btrim(p_external_id),
      name = pg_catalog.btrim(p_name),
      current_price = p_current_price,
      currency = v_project_currency,
      metadata = case
        when pg_catalog.btrim(p_name) is distinct from v_provider_name
          or p_current_price is distinct from v_provider_price
          or v_project_currency is distinct from v_provider_currency
          then product.metadata || '{"manual_override":true}'::jsonb
        else product.metadata - 'manual_override'
      end
  where product.id = p_product_id;

  select mapping.id, mapping.project_id, mapping.funnel_stage_id, mapping.effective_from,
         mapping.funnel_stage_name_snapshot, mapping.stage_type_snapshot
  into v_current_mapping_id, v_current_project_id, v_current_stage_id, v_effective_from,
       v_mapping_stage_name, v_mapping_stage_type
  from public.product_mappings mapping
  where mapping.product_id = p_product_id
    and mapping.effective_to is null
  for update;

  if v_current_mapping_id is not null and v_current_project_id <> p_project_id then
    raise exception 'product is mapped to another project';
  end if;

  if p_funnel_stage_id is null then
    if v_current_mapping_id is not null then
      update public.product_mappings
      set effective_to = greatest(
        pg_catalog.clock_timestamp(),
        effective_from + interval '1 microsecond'
      )
      where id = v_current_mapping_id;
    end if;
  else
    select stage.name, stage.stage_type
    into v_stage_name, v_stage_type
    from public.funnel_stages stage
    where stage.id = p_funnel_stage_id
      and stage.organization_id = p_organization_id
      and stage.project_id = p_project_id
      and stage.archived_at is null;
    if not found then
      raise exception 'active funnel stage not found';
    end if;

    if v_current_mapping_id is null then
      select exists (
        select 1 from public.product_mappings mapping
        where mapping.product_id = p_product_id
      ) into v_has_history;
      v_effective_from := case
        when v_has_history then pg_catalog.clock_timestamp()
        else pg_catalog.to_timestamp(0)
      end;
      insert into public.product_mappings (
        organization_id, project_id, product_id, funnel_stage_id,
        effective_from, created_by, funnel_stage_name_snapshot, stage_type_snapshot
      )
      values (
        p_organization_id, p_project_id, p_product_id, p_funnel_stage_id,
        v_effective_from, auth.uid(), v_stage_name, v_stage_type
      )
      returning id into v_mapping_id;
    elsif v_current_stage_id <> p_funnel_stage_id then
      v_transition_at := greatest(
        pg_catalog.clock_timestamp(),
        v_effective_from + interval '1 microsecond'
      );
      update public.product_mappings
      set effective_to = v_transition_at
      where id = v_current_mapping_id;
      v_effective_from := v_transition_at;
      insert into public.product_mappings (
        organization_id, project_id, product_id, funnel_stage_id,
        effective_from, created_by, funnel_stage_name_snapshot, stage_type_snapshot
      )
      values (
        p_organization_id, p_project_id, p_product_id, p_funnel_stage_id,
        v_effective_from, auth.uid(), v_stage_name, v_stage_type
      )
      returning id into v_mapping_id;
    else
      v_mapping_id := v_current_mapping_id;
      v_stage_name := coalesce(v_mapping_stage_name, v_stage_name);
      v_stage_type := coalesce(v_mapping_stage_type, v_stage_type);
    end if;

    if v_connection_id is not null then
      for pending_event in
        update public.sales_events event
        set project_id = p_project_id,
            processed_at = now()
        where event.organization_id = p_organization_id
          and event.connection_id = v_connection_id
          and event.project_id is null
          and event.event_at >= v_effective_from
          and event.currency = v_project_currency
          and event.payload ->> 'product_external_id' = pg_catalog.btrim(p_external_id)
        returning event.id, event.gross_amount, event.net_amount
      loop
        insert into public.sales_event_items (
          organization_id, sales_event_id, product_id, funnel_stage_id,
          product_mapping_id, quantity, gross_amount, net_amount,
          product_name_snapshot, funnel_stage_name_snapshot, stage_type_snapshot
        )
        values (
          p_organization_id, pending_event.id, p_product_id, p_funnel_stage_id,
          v_mapping_id, 1, pending_event.gross_amount, pending_event.net_amount,
          pg_catalog.btrim(p_name), v_stage_name, v_stage_type
        )
        on conflict (sales_event_id, product_id) do nothing;
      end loop;
    end if;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(), 'product.updated', 'product', p_product_id::text,
    pg_catalog.jsonb_build_object('project_id', p_project_id)
  );
end;
$$;

create or replace function public.set_project_product_archived(
  p_organization_id uuid,
  p_project_id uuid,
  p_product_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapping_project_id uuid;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  if p_archived is null then
    raise exception 'archived state is required';
  end if;
  perform 1
  from public.projects project
    where project.id = p_project_id
      and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'project not found';
  end if;

  perform 1
  from public.products product
  where product.id = p_product_id
    and product.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'product not found';
  end if;

  select mapping.project_id into v_mapping_project_id
  from public.product_mappings mapping
  where mapping.product_id = p_product_id
    and mapping.effective_to is null
  for update;
  if v_mapping_project_id is not null and v_mapping_project_id <> p_project_id then
    raise exception 'product is mapped to another project';
  end if;

  if p_archived then
    update public.product_mappings mapping
    set effective_to = greatest(
      pg_catalog.clock_timestamp(),
      mapping.effective_from + interval '1 microsecond'
    )
    where mapping.product_id = p_product_id
      and mapping.effective_to is null;
  end if;

  update public.products product
  set archived_at = case
        when p_archived then coalesce(product.archived_at, pg_catalog.clock_timestamp())
        else null
      end,
      is_active = not p_archived
  where product.id = p_product_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(),
    case when p_archived then 'product.archived' else 'product.restored' end,
    'product', p_product_id::text,
    pg_catalog.jsonb_build_object('project_id', p_project_id)
  );
end;
$$;

create or replace function public.replace_project_product_mappings(
  p_organization_id uuid,
  p_project_id uuid,
  p_mappings jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested record;
  pending_event record;
  v_connection_id uuid;
  v_external_id text;
  v_product_name text;
  v_product_currency text;
  v_project_currency text;
  v_stage_name text;
  v_stage_type public.funnel_stage_type;
  v_mapping_stage_name text;
  v_mapping_stage_type public.funnel_stage_type;
  v_current_mapping_id uuid;
  v_current_project_id uuid;
  v_current_stage_id uuid;
  v_effective_from timestamptz;
  v_transition_at timestamptz;
  v_has_history boolean;
  v_mapping_id uuid;
  v_mapping_count integer;
  v_distinct_product_count integer;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  select project.currency into v_project_currency
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if v_project_currency is null then
    raise exception 'project not found';
  end if;
  if p_mappings is null
    or pg_catalog.jsonb_typeof(p_mappings) is distinct from 'array' then
    raise exception 'mappings must be an array';
  end if;

  select pg_catalog.count(*), pg_catalog.count(distinct selected.product_id)
  into v_mapping_count, v_distinct_product_count
  from pg_catalog.jsonb_to_recordset(p_mappings)
    as selected(product_id uuid, funnel_stage_id uuid);
  if v_mapping_count <> v_distinct_product_count then
    raise exception 'each product can be mapped only once';
  end if;

  perform product.id
  from public.products product
  where product.organization_id = p_organization_id
    and (
      product.id in (
        select selected.product_id
        from pg_catalog.jsonb_to_recordset(p_mappings)
          as selected(product_id uuid, funnel_stage_id uuid)
      )
      or product.id in (
        select mapping.product_id
        from public.product_mappings mapping
        where mapping.project_id = p_project_id
          and mapping.effective_to is null
      )
    )
  order by product.id
  for update;

  update public.product_mappings mapping
  set effective_to = greatest(
    pg_catalog.clock_timestamp(),
    mapping.effective_from + interval '1 microsecond'
  )
  where mapping.organization_id = p_organization_id
    and mapping.project_id = p_project_id
    and mapping.effective_to is null
    and not exists (
      select 1
      from pg_catalog.jsonb_to_recordset(p_mappings)
        as selected(product_id uuid, funnel_stage_id uuid)
      where selected.product_id = mapping.product_id
    );

  for requested in
    select product_id, funnel_stage_id
    from pg_catalog.jsonb_to_recordset(p_mappings)
      as selected(product_id uuid, funnel_stage_id uuid)
  loop
    select product.connection_id, product.external_id, product.name, product.currency
    into v_connection_id, v_external_id, v_product_name, v_product_currency
    from public.products product
    where product.id = requested.product_id
      and product.organization_id = p_organization_id
      and product.archived_at is null;
    if not found then
      raise exception 'active product not found';
    end if;
    if v_product_currency <> v_project_currency then
      raise exception 'product currency does not match project currency';
    end if;

    select stage.name, stage.stage_type
    into v_stage_name, v_stage_type
    from public.funnel_stages stage
    where stage.id = requested.funnel_stage_id
      and stage.organization_id = p_organization_id
      and stage.project_id = p_project_id
      and stage.archived_at is null;
    if not found then
      raise exception 'active funnel stage not found';
    end if;

    v_current_mapping_id := null;
    v_current_project_id := null;
    v_current_stage_id := null;
    v_effective_from := null;
    select mapping.id, mapping.project_id, mapping.funnel_stage_id, mapping.effective_from,
           mapping.funnel_stage_name_snapshot, mapping.stage_type_snapshot
    into v_current_mapping_id, v_current_project_id, v_current_stage_id, v_effective_from,
         v_mapping_stage_name, v_mapping_stage_type
    from public.product_mappings mapping
    where mapping.product_id = requested.product_id
      and mapping.effective_to is null
    for update;

    if v_current_mapping_id is null then
      select exists (
        select 1 from public.product_mappings mapping
        where mapping.product_id = requested.product_id
      ) into v_has_history;
      v_effective_from := case
        when v_has_history then pg_catalog.clock_timestamp()
        else pg_catalog.to_timestamp(0)
      end;
      insert into public.product_mappings (
        organization_id, project_id, product_id, funnel_stage_id,
        effective_from, created_by, funnel_stage_name_snapshot, stage_type_snapshot
      )
      values (
        p_organization_id, p_project_id, requested.product_id,
        requested.funnel_stage_id, v_effective_from, auth.uid(),
        v_stage_name, v_stage_type
      )
      returning id into v_mapping_id;
    elsif v_current_project_id <> p_project_id then
      raise exception 'product is mapped to another project';
    elsif v_current_stage_id <> requested.funnel_stage_id then
      v_transition_at := greatest(
        pg_catalog.clock_timestamp(),
        v_effective_from + interval '1 microsecond'
      );
      update public.product_mappings
      set effective_to = v_transition_at
      where id = v_current_mapping_id;

      v_effective_from := v_transition_at;
      insert into public.product_mappings (
        organization_id, project_id, product_id, funnel_stage_id,
        effective_from, created_by, funnel_stage_name_snapshot, stage_type_snapshot
      )
      values (
        p_organization_id, p_project_id, requested.product_id,
        requested.funnel_stage_id, v_effective_from, auth.uid(),
        v_stage_name, v_stage_type
      )
      returning id into v_mapping_id;
    else
      v_mapping_id := v_current_mapping_id;
      v_stage_name := coalesce(v_mapping_stage_name, v_stage_name);
      v_stage_type := coalesce(v_mapping_stage_type, v_stage_type);
    end if;

    if v_connection_id is not null then
      for pending_event in
        update public.sales_events event
        set project_id = p_project_id,
            processed_at = now()
        where event.organization_id = p_organization_id
          and event.connection_id = v_connection_id
          and event.project_id is null
          and event.event_at >= v_effective_from
          and event.currency = v_project_currency
          and event.payload ->> 'product_external_id' = v_external_id
        returning event.id, event.gross_amount, event.net_amount
      loop
        insert into public.sales_event_items (
          organization_id, sales_event_id, product_id, funnel_stage_id,
          product_mapping_id, gross_amount, net_amount,
          product_name_snapshot, funnel_stage_name_snapshot, stage_type_snapshot
        )
        values (
          p_organization_id, pending_event.id, requested.product_id,
          requested.funnel_stage_id, v_mapping_id,
          pending_event.gross_amount, pending_event.net_amount,
          v_product_name, v_stage_name, v_stage_type
        )
        on conflict (sales_event_id, product_id) do nothing;
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function public.set_project_meta_account(
  p_organization_id uuid,
  p_project_id uuid,
  p_provider_account_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'project not found';
  end if;
  if p_provider_account_id is not null and not exists (
    select 1
    from public.provider_accounts account
    join public.integration_connections connection on connection.id = account.connection_id
    where account.id = p_provider_account_id
      and account.organization_id = p_organization_id
      and account.account_type = 'meta_ad_account'
      and account.is_active
      and account.currency = (
        select project.currency from public.projects project
        where project.id = p_project_id
      )
      and account.timezone = (
        select project.reporting_timezone from public.projects project
        where project.id = p_project_id
      )
      and connection.provider = 'meta'
      and connection.revoked_at is null
  ) then
    raise exception 'active Meta account not found';
  end if;

  delete from public.project_accounts link
  where link.organization_id = p_organization_id
    and link.project_id = p_project_id
    and (p_provider_account_id is null or link.provider_account_id <> p_provider_account_id);

  if p_provider_account_id is not null then
    insert into public.project_accounts (
      organization_id, project_id, provider_account_id, is_primary
    )
    values (p_organization_id, p_project_id, p_provider_account_id, true)
    on conflict (project_id, provider_account_id) do update
    set is_primary = true;
  end if;
end;
$$;

alter table public.traffic_metrics_daily
  drop constraint if exists traffic_metrics_daily_project_id_provider_account_id_fkey;

create or replace function public.ingest_hotmart_sale(
  p_connection_id uuid,
  p_external_event_id text,
  p_external_transaction_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_product_external_id text,
  p_product_name text,
  p_gross_amount numeric,
  p_net_amount numeric,
  p_currency text,
  p_payload jsonb default '{}'::jsonb
)
returns table (event_id uuid, duplicate boolean, mapped boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_project_id uuid;
  v_stage_id uuid;
  v_stage_name text;
  v_stage_type public.funnel_stage_type;
  v_mapping_id uuid;
  v_event_id uuid;
  v_event_by_external_id uuid;
  v_event_by_transaction_id uuid;
  v_result_project_id uuid;
  v_existing_event_type text;
  v_payload jsonb;
  v_external_event_id text;
  v_external_transaction_id text;
  v_product_external_id text;
begin
  select connection.organization_id into v_organization_id
  from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.provider = 'hotmart'
    and connection.revoked_at is null
  for update;

  if v_organization_id is null then
    raise exception 'active Hotmart connection not found';
  end if;
  if p_event_type not in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED') then
    raise exception 'unsupported Hotmart event';
  end if;
  if p_external_event_id is null
    or p_external_transaction_id is null
    or p_product_external_id is null
    or pg_catalog.length(pg_catalog.btrim(p_external_event_id)) = 0
    or pg_catalog.length(pg_catalog.btrim(p_external_transaction_id)) = 0
    or pg_catalog.length(pg_catalog.btrim(p_product_external_id)) = 0 then
    raise exception 'stable event, transaction and product identifiers are required';
  end if;
  if p_gross_amount is null or p_gross_amount < 0
    or p_net_amount is null or p_net_amount < 0
    or p_currency is null or p_currency !~ '^[A-Za-z]{3}$' then
    raise exception 'invalid sale amounts or currency';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Hotmart payload must be an object';
  end if;

  v_external_event_id := pg_catalog.btrim(p_external_event_id);
  v_external_transaction_id := pg_catalog.btrim(p_external_transaction_id);
  v_product_external_id := pg_catalog.btrim(p_product_external_id);

  v_payload := coalesce(p_payload, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'product_external_id', v_product_external_id
  );

  select event.id into v_event_by_external_id
  from public.sales_events event
  where event.connection_id = p_connection_id
    and event.external_event_id = v_external_event_id;

  select event.id into v_event_by_transaction_id
  from public.sales_events event
  where event.connection_id = p_connection_id
    and event.external_transaction_id = v_external_transaction_id
    and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED');

  if v_event_by_external_id is not null
    and v_event_by_transaction_id is not null
    and v_event_by_external_id <> v_event_by_transaction_id then
    raise exception 'Hotmart event and transaction identifiers conflict';
  end if;

  v_event_id := coalesce(v_event_by_external_id, v_event_by_transaction_id);
  if v_event_id is not null then
    select event.project_id, event.event_type
    into v_result_project_id, v_existing_event_type
    from public.sales_events event
    where event.id = v_event_id
    for update;
  end if;

  if v_event_id is not null
    and v_existing_event_type = 'PURCHASE_COMPLETED'
    and p_event_type = 'PURCHASE_APPROVED' then
    return query select v_event_id, true, v_result_project_id is not null;
    return;
  end if;

  insert into public.products (
    organization_id, connection_id, external_id, name, current_price, currency,
    source, provider_name, provider_price, provider_currency
  )
  values (
    v_organization_id, p_connection_id, v_product_external_id,
    coalesce(nullif(pg_catalog.btrim(p_product_name), ''), v_product_external_id),
    p_gross_amount, pg_catalog.upper(p_currency), 'provider',
    coalesce(nullif(pg_catalog.btrim(p_product_name), ''), v_product_external_id),
    p_gross_amount, pg_catalog.upper(p_currency)
  )
  on conflict (connection_id, external_id) do update
  set provider_name = excluded.provider_name,
      provider_price = excluded.provider_price,
      provider_currency = excluded.provider_currency,
      name = case
        when public.products.metadata @> '{"manual_override":true}'::jsonb
          then public.products.name
        else excluded.name
      end,
      current_price = case
        when public.products.metadata @> '{"manual_override":true}'::jsonb
          then public.products.current_price
        else excluded.current_price
      end,
      currency = case
        when public.products.metadata @> '{"manual_override":true}'::jsonb
          then public.products.currency
        else excluded.currency
      end,
      is_active = true
  returning id, name into v_product_id, v_product_name;

  select mapping.id, mapping.project_id, mapping.funnel_stage_id,
         coalesce(mapping.funnel_stage_name_snapshot, stage.name),
         coalesce(mapping.stage_type_snapshot, stage.stage_type)
  into v_mapping_id, v_project_id, v_stage_id, v_stage_name, v_stage_type
  from public.product_mappings mapping
  join public.projects project on project.id = mapping.project_id
  join public.funnel_stages stage on stage.id = mapping.funnel_stage_id
  join public.products product on product.id = mapping.product_id
  where mapping.organization_id = v_organization_id
    and mapping.product_id = v_product_id
    and mapping.effective_from <= p_event_at
    and (mapping.effective_to is null or mapping.effective_to > p_event_at)
    and project.currency = pg_catalog.upper(p_currency)
  order by mapping.effective_from desc
  limit 1;

  begin
    insert into public.sales_events (
      organization_id, project_id, connection_id, external_event_id,
      external_transaction_id, event_type, event_at, gross_amount, net_amount,
      currency, payload, processed_at
    )
    values (
      v_organization_id, v_project_id, p_connection_id, v_external_event_id,
      v_external_transaction_id, p_event_type, p_event_at, p_gross_amount,
      p_net_amount, pg_catalog.upper(p_currency), v_payload,
      case when v_project_id is null then null else now() end
    )
    returning id into v_event_id;
  exception when unique_violation then
    select event.id into v_event_by_external_id
    from public.sales_events event
    where event.connection_id = p_connection_id
      and event.external_event_id = v_external_event_id;

    select event.id into v_event_by_transaction_id
    from public.sales_events event
    where event.connection_id = p_connection_id
      and event.external_transaction_id = v_external_transaction_id
      and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED');

    if v_event_by_external_id is not null
      and v_event_by_transaction_id is not null
      and v_event_by_external_id <> v_event_by_transaction_id then
      raise exception 'Hotmart event and transaction identifiers conflict';
    end if;

    v_event_id := coalesce(v_event_by_external_id, v_event_by_transaction_id);

    if v_event_id is null then
      raise;
    end if;
    select event.project_id, event.event_type
    into v_result_project_id, v_existing_event_type
    from public.sales_events event
    where event.id = v_event_id
    for update;
    if v_existing_event_type = 'PURCHASE_COMPLETED'
      and p_event_type = 'PURCHASE_APPROVED' then
      return query select v_event_id, true, v_result_project_id is not null;
      return;
    end if;

    update public.sales_events event
    set event_type = case
          when p_event_type = 'PURCHASE_COMPLETED' then p_event_type
          else event.event_type
        end,
        event_at = p_event_at,
        gross_amount = p_gross_amount,
        net_amount = p_net_amount,
        currency = pg_catalog.upper(p_currency),
        payload = v_payload,
        project_id = coalesce(event.project_id, v_project_id),
        processed_at = case
          when coalesce(event.project_id, v_project_id) is null then null
          else coalesce(event.processed_at, now())
        end
    where event.id = v_event_id
    returning event.project_id into v_result_project_id;

    update public.sales_event_items item
    set gross_amount = p_gross_amount,
        net_amount = p_net_amount
    where item.sales_event_id = v_event_id;

    if v_result_project_id is not null and not exists (
      select 1 from public.sales_event_items item
      where item.sales_event_id = v_event_id
    ) then
      insert into public.sales_event_items (
        organization_id, sales_event_id, product_id, funnel_stage_id,
        product_mapping_id, quantity, gross_amount, net_amount,
        product_name_snapshot, funnel_stage_name_snapshot, stage_type_snapshot
      )
      values (
        v_organization_id, v_event_id, v_product_id, v_stage_id,
        v_mapping_id, 1, p_gross_amount, p_net_amount,
        v_product_name, v_stage_name, v_stage_type
      );
    end if;

    return query select v_event_id, true, v_result_project_id is not null;
    return;
  end;

  if v_project_id is not null then
    insert into public.sales_event_items (
      organization_id, sales_event_id, product_id, funnel_stage_id,
      product_mapping_id, quantity, gross_amount, net_amount,
      product_name_snapshot, funnel_stage_name_snapshot, stage_type_snapshot
    )
    values (
      v_organization_id, v_event_id, v_product_id, v_stage_id,
      v_mapping_id, 1, p_gross_amount, p_net_amount,
      v_product_name, v_stage_name, v_stage_type
    );
  end if;

  return query select v_event_id, false, v_project_id is not null;
end;
$$;

revoke all on function public.create_project_funnel_stage(
  uuid, uuid, text, public.funnel_stage_type, text
) from public, anon;
revoke all on function public.update_project_funnel_stage(
  uuid, uuid, uuid, text, public.funnel_stage_type, text, boolean
) from public, anon;
revoke all on function public.reorder_project_funnel_stages(
  uuid, uuid, uuid[]
) from public, anon;
revoke all on function public.create_project_product(
  uuid, uuid, uuid, text, text, numeric, text, uuid
) from public, anon;
revoke all on function public.update_project_product(
  uuid, uuid, uuid, text, text, numeric, text, uuid
) from public, anon;
revoke all on function public.set_project_product_archived(
  uuid, uuid, uuid, boolean
) from public, anon;
revoke all on function public.delete_empty_integration_connection(
  uuid, uuid
) from public, anon;

grant execute on function public.create_project_funnel_stage(
  uuid, uuid, text, public.funnel_stage_type, text
) to authenticated;
grant execute on function public.update_project_funnel_stage(
  uuid, uuid, uuid, text, public.funnel_stage_type, text, boolean
) to authenticated;
grant execute on function public.reorder_project_funnel_stages(
  uuid, uuid, uuid[]
) to authenticated;
grant execute on function public.create_project_product(
  uuid, uuid, uuid, text, text, numeric, text, uuid
) to authenticated;
grant execute on function public.update_project_product(
  uuid, uuid, uuid, text, text, numeric, text, uuid
) to authenticated;
grant execute on function public.set_project_product_archived(
  uuid, uuid, uuid, boolean
) to authenticated;
grant execute on function public.delete_empty_integration_connection(
  uuid, uuid
) to authenticated;

alter function public.create_project_with_defaults(
  uuid, text, text, text, text, text, numeric, numeric, uuid, text
) security definer;
alter function public.set_project_meta_account(uuid, uuid, uuid) security definer;

revoke insert, update, delete on public.products, public.funnel_stages
  from authenticated;
revoke insert, delete on public.projects, public.integration_connections
  from authenticated;
revoke delete on public.provider_accounts from authenticated;
revoke insert, update, delete on public.project_accounts from authenticated;
