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
      and connection.provider in ('hotmart', 'eduzz', 'kiwify', 'hubla')
      and connection.status = 'connected'
      and connection.revoked_at is null
  ) then
    raise exception 'active sales connection not found';
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

create or replace function public.create_project_with_funnel(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_expert_name text,
  p_expert_email text,
  p_sales_provider text,
  p_sales_connection_id uuid,
  p_monthly_target numeric,
  p_margin_target numeric,
  p_funnel jsonb,
  p_meta_connection_id uuid default null,
  p_meta_account_external_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested record;
  v_expert_id uuid;
  v_project_id uuid;
  v_provider_account_id uuid;
  v_stage_id uuid;
  v_stage_name text;
  v_stage_type public.funnel_stage_type;
  v_stage_color text;
  v_product_id uuid;
  v_product_count integer;
  v_distinct_product_count integer;
  v_connection_provider text;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  if pg_catalog.length(pg_catalog.btrim(p_name)) not between 2 and 120
    or pg_catalog.length(pg_catalog.btrim(p_expert_name)) not between 2 and 120
    or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid project data';
  end if;
  if p_sales_provider not in ('hotmart', 'eduzz', 'kiwify', 'hubla') then
    raise exception 'unsupported sales provider';
  end if;

  select connection.provider::text
  into v_connection_provider
  from public.integration_connections connection
  where connection.id = p_sales_connection_id
    and connection.organization_id = p_organization_id
    and connection.status = 'connected'
    and connection.revoked_at is null
  for update;
  if v_connection_provider is null or v_connection_provider <> p_sales_provider then
    raise exception 'active sales connection not found';
  end if;

  if p_funnel is null or pg_catalog.jsonb_typeof(p_funnel) <> 'array'
    or pg_catalog.jsonb_array_length(p_funnel) not between 1 and 100 then
    raise exception 'funnel must contain between 1 and 100 stages';
  end if;

  select pg_catalog.count(product_id), pg_catalog.count(distinct product_id)
  into v_product_count, v_distinct_product_count
  from (
    select nullif(stage.value ->> 'productId', '')::uuid as product_id
    from pg_catalog.jsonb_array_elements(p_funnel) stage(value)
  ) selected
  where product_id is not null;
  if v_product_count <> v_distinct_product_count then
    raise exception 'each product can appear only once';
  end if;

  perform product.id
  from public.products product
  where product.id in (
      select nullif(stage.value ->> 'productId', '')::uuid
      from pg_catalog.jsonb_array_elements(p_funnel) stage(value)
      where nullif(stage.value ->> 'productId', '') is not null
    )
  order by product.id
  for update;

  insert into public.experts (organization_id, name, email)
  values (p_organization_id, pg_catalog.btrim(p_expert_name), p_expert_email)
  returning id into v_expert_id;

  insert into public.projects (
    organization_id, expert_id, name, slug, status,
    monthly_revenue_target, margin_target, settings
  )
  values (
    p_organization_id, v_expert_id, pg_catalog.btrim(p_name), p_slug, 'draft',
    p_monthly_target, p_margin_target,
    pg_catalog.jsonb_build_object(
      'sales_provider', p_sales_provider,
      'sales_connection_id', p_sales_connection_id
    )
  )
  returning id into v_project_id;

  for requested in
    select stage.value, stage.ordinality::integer as position
    from pg_catalog.jsonb_array_elements(p_funnel) with ordinality as stage(value, ordinality)
    order by stage.ordinality
  loop
    v_stage_name := pg_catalog.btrim(requested.value ->> 'name');
    v_stage_color := nullif(pg_catalog.btrim(requested.value ->> 'color'), '');
    v_product_id := nullif(requested.value ->> 'productId', '')::uuid;
    if pg_catalog.length(v_stage_name) not between 2 and 120 then
      raise exception 'invalid funnel stage name';
    end if;
    if not exists (
      select 1
      from pg_catalog.pg_enum enum_value
      join pg_catalog.pg_type enum_type on enum_type.oid = enum_value.enumtypid
      join pg_catalog.pg_namespace namespace on namespace.oid = enum_type.typnamespace
      where namespace.nspname = 'public'
        and enum_type.typname = 'funnel_stage_type'
        and enum_value.enumlabel = requested.value ->> 'type'
    ) then
      raise exception 'invalid funnel stage type';
    end if;
    v_stage_type := (requested.value ->> 'type')::public.funnel_stage_type;
    if v_stage_color is not null and v_stage_color !~ '^#[0-9a-fA-F]{6}$' then
      raise exception 'invalid funnel stage color';
    end if;

    insert into public.funnel_stages (
      organization_id, project_id, name, stage_type, position, color
    )
    values (
      p_organization_id, v_project_id, v_stage_name, v_stage_type,
      requested.position, v_stage_color
    )
    returning id into v_stage_id;

    if v_product_id is not null then
      perform 1
      from public.products product
      where product.id = v_product_id
        and product.organization_id = p_organization_id
        and product.connection_id = p_sales_connection_id
        and product.currency = 'BRL'
        and product.is_active
        and product.archived_at is null
        and not exists (
          select 1
          from public.product_mappings mapping
          where mapping.product_id = product.id
            and mapping.effective_to is null
        );
      if not found then
        raise exception 'active product is not available for this connection';
      end if;

      insert into public.product_mappings (
        organization_id, project_id, product_id, funnel_stage_id,
        effective_from, created_by, funnel_stage_name_snapshot, stage_type_snapshot
      )
      values (
        p_organization_id, v_project_id, v_product_id, v_stage_id,
        pg_catalog.to_timestamp(0), auth.uid(), v_stage_name, v_stage_type
      );
    end if;
  end loop;

  if (p_meta_connection_id is null) <> (p_meta_account_external_id is null) then
    raise exception 'Meta connection and account must be provided together';
  end if;
  if p_meta_connection_id is not null then
    select account.id into v_provider_account_id
    from public.provider_accounts account
    join public.integration_connections connection on connection.id = account.connection_id
    where account.organization_id = p_organization_id
      and account.connection_id = p_meta_connection_id
      and account.external_id = p_meta_account_external_id
      and account.account_type = 'meta_ad_account'
      and account.is_active
      and account.currency = 'BRL'
      and account.timezone = 'America/Sao_Paulo'
      and connection.provider = 'meta'
      and connection.status = 'connected'
      and connection.revoked_at is null;
    if v_provider_account_id is null then
      raise exception 'active Meta account not found';
    end if;

    insert into public.project_accounts (
      organization_id, project_id, provider_account_id, is_primary
    )
    values (p_organization_id, v_project_id, v_provider_account_id, true);
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(), 'project.created', 'project', v_project_id::text,
    pg_catalog.jsonb_build_object(
      'sales_provider', p_sales_provider,
      'sales_connection_id', p_sales_connection_id,
      'funnel_stages', pg_catalog.jsonb_array_length(p_funnel)
    )
  );

  return pg_catalog.jsonb_build_object(
    'id', v_project_id,
    'name', pg_catalog.btrim(p_name),
    'slug', p_slug,
    'status', 'draft'
  );
end;
$$;

revoke all on function public.create_project_with_funnel(
  uuid, text, text, text, text, text, uuid, numeric, numeric, jsonb, uuid, text
) from public, anon;
grant execute on function public.create_project_with_funnel(
  uuid, text, text, text, text, text, uuid, numeric, numeric, jsonb, uuid, text
) to authenticated;
