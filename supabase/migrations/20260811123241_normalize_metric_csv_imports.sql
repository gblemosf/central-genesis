create table if not exists public.mapeamento_produtos (
  product_id text primary key,
  projeto text not null,
  campo text not null,
  nome_produto text,
  updated_at timestamptz default now(),
  organization_id uuid references public.organizations(id) on delete set null
);

alter table public.mapeamento_produtos enable row level security;
revoke all on table public.mapeamento_produtos from public, anon, authenticated;
grant select on table public.mapeamento_produtos to authenticated;
drop policy if exists legacy_mapeamento_produtos_read on public.mapeamento_produtos;
create policy legacy_mapeamento_produtos_read on public.mapeamento_produtos
for select to authenticated
using (organization_id is not null and public.is_org_member(organization_id));

create table public.metric_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  original_filename text not null check (length(original_filename) between 1 and 255),
  storage_bucket text not null default 'metric-imports',
  storage_path text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  delimiter text not null check (delimiter in (',', ';', E'\t')),
  headers jsonb not null check (jsonb_typeof(headers) = 'array'),
  period_start date not null,
  period_end date not null,
  rows_received integer not null check (rows_received > 0),
  rows_written integer not null default 0 check (rows_written >= 0),
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint metric_imports_project_fk
    foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  constraint metric_imports_period_check check (period_start <= period_end),
  constraint metric_imports_file_unique unique (project_id, content_sha256),
  constraint metric_imports_storage_path_unique unique (storage_bucket, storage_path),
  unique (organization_id, id)
);

create index metric_imports_organization_project_created_idx
  on public.metric_imports (organization_id, project_id, created_at desc);

create table public.metric_import_rows (
  organization_id uuid not null,
  import_id uuid not null,
  line_number integer not null check (line_number > 1),
  metric_date date not null,
  raw_values jsonb not null check (jsonb_typeof(raw_values) = 'object'),
  normalized_values jsonb not null check (jsonb_typeof(normalized_values) = 'object'),
  created_at timestamptz not null default now(),
  primary key (import_id, line_number),
  constraint metric_import_rows_import_fk
    foreign key (organization_id, import_id)
    references public.metric_imports(organization_id, id) on delete cascade
);

create table public.project_csv_daily_metrics (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  metric_date date not null,
  investment numeric not null,
  impressions bigint not null,
  clicks bigint not null,
  page_views bigint not null,
  checkouts bigint not null,
  core_sales bigint not null,
  order_bump_1_sales bigint not null,
  order_bump_2_sales bigint not null,
  order_bump_3_sales bigint not null,
  import_id uuid not null,
  imported_at timestamptz not null default now(),
  primary key (project_id, metric_date),
  constraint project_csv_daily_metrics_project_fk
    foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  constraint project_csv_daily_metrics_import_fk
    foreign key (organization_id, import_id)
    references public.metric_imports(organization_id, id),
  constraint project_csv_daily_metrics_values_check check (
    investment >= 0 and investment <> 'NaN'::numeric
    and impressions >= 0 and clicks >= 0 and page_views >= 0 and checkouts >= 0
    and core_sales >= 0 and order_bump_1_sales >= 0
    and order_bump_2_sales >= 0 and order_bump_3_sales >= 0
  )
);

create index project_csv_daily_metrics_organization_project_date_idx
  on public.project_csv_daily_metrics (organization_id, project_id, metric_date);
create index project_csv_daily_metrics_import_idx
  on public.project_csv_daily_metrics (import_id);

alter table public.metric_imports enable row level security;
alter table public.metric_import_rows enable row level security;
alter table public.project_csv_daily_metrics enable row level security;

revoke all on table public.metric_imports from public, anon, authenticated;
revoke all on table public.metric_import_rows from public, anon, authenticated;
revoke all on table public.project_csv_daily_metrics from public, anon, authenticated;
grant select on table public.metric_imports to authenticated;
grant select on table public.metric_import_rows to authenticated;
grant select on table public.project_csv_daily_metrics to authenticated;

create policy metric_imports_read on public.metric_imports
for select to authenticated
using (public.is_org_member(organization_id));

create policy metric_import_rows_read on public.metric_import_rows
for select to authenticated
using (public.is_org_member(organization_id));

create policy project_csv_daily_metrics_read on public.project_csv_daily_metrics
for select to authenticated
using (public.is_org_member(organization_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('metric-imports', 'metric-imports', false, 5242880, array['text/csv', 'text/plain'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy metric_import_objects_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'metric-imports'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.is_org_admin(((storage.foldername(name))[1])::uuid)
);

create policy metric_import_objects_read on storage.objects
for select to authenticated
using (
  bucket_id = 'metric-imports'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.is_org_member(((storage.foldername(name))[1])::uuid)
);

create policy metric_import_objects_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'metric-imports'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and public.is_org_admin(((storage.foldername(name))[1])::uuid)
);

create or replace function public.import_project_daily_metrics(
  p_organization_id uuid,
  p_project_id uuid,
  p_file jsonb,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_record record;
  v_import_id uuid;
  v_existing_id uuid;
  v_existing_period_start date;
  v_existing_period_end date;
  v_line_number integer;
  v_metric_date date;
  v_investment numeric;
  v_impressions bigint;
  v_clicks bigint;
  v_page_views bigint;
  v_checkouts bigint;
  v_core_sales bigint;
  v_order_bump_1_sales bigint;
  v_order_bump_2_sales bigint;
  v_order_bump_3_sales bigint;
  v_rows_written integer;
  v_seen_lines integer[] := array[]::integer[];
  v_seen_dates date[] := array[]::date[];
  v_filename text;
  v_storage_path text;
  v_content_sha256 text;
  v_delimiter text;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'administrator permission required' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null
    or p_period_start > p_period_end
    or p_period_end - p_period_start > 365 then
    raise exception 'invalid metrics period' using errcode = '22007';
  end if;
  if jsonb_typeof(coalesce(p_file, 'null'::jsonb)) <> 'object' then
    raise exception 'one metric file is required' using errcode = '22023';
  end if;

  perform 1
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and project.deleted_at is null
  for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  v_filename := p_file ->> 'filename';
  v_storage_path := p_file ->> 'storagePath';
  v_content_sha256 := p_file ->> 'sha256';
  v_delimiter := p_file ->> 'delimiter';
  if coalesce(p_file ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or nullif(btrim(coalesce(v_filename, '')), '') is null
    or length(v_filename) > 255
    or nullif(btrim(coalesce(v_storage_path, '')), '') is null
    or coalesce(v_content_sha256, '') !~ '^[0-9a-f]{64}$'
    or coalesce(v_delimiter, '') not in (',', ';', E'\t') then
    raise exception 'invalid metric file metadata' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_file -> 'headers'), '') <> 'array'
    or coalesce(jsonb_typeof(p_file -> 'rows'), '') <> 'array' then
    raise exception 'invalid metric file metadata' using errcode = '22023';
  end if;
  if jsonb_array_length(p_file -> 'headers') = 0
    or jsonb_array_length(p_file -> 'rows') = 0
    or exists (
      select 1
      from jsonb_array_elements(p_file -> 'headers') header
      where jsonb_typeof(header) <> 'string'
        or nullif(btrim(header #>> '{}'), '') is null
    ) then
    raise exception 'invalid metric file metadata' using errcode = '22023';
  end if;
  if v_storage_path not like p_organization_id::text || '/' || p_project_id::text || '/%'
    or length(v_storage_path) <= length(p_organization_id::text || '/' || p_project_id::text || '/') then
    raise exception 'invalid metric storage path' using errcode = '22023';
  end if;
  v_import_id := (p_file ->> 'id')::uuid;

  for row_record in
    select value as row
    from jsonb_array_elements(p_file -> 'rows')
  loop
    if jsonb_typeof(row_record.row) <> 'object'
      or jsonb_typeof(row_record.row -> 'raw') <> 'object'
      or jsonb_typeof(row_record.row -> 'data') <> 'object'
      or nullif(row_record.row ->> 'line', '') is null
      or nullif(row_record.row #>> '{data,date}', '') is null
      or nullif(row_record.row #>> '{data,investment}', '') is null
      or nullif(row_record.row #>> '{data,impressions}', '') is null
      or nullif(row_record.row #>> '{data,clicks}', '') is null
      or nullif(row_record.row #>> '{data,page_views}', '') is null
      or nullif(row_record.row #>> '{data,checkouts}', '') is null
      or nullif(row_record.row #>> '{data,core_sales}', '') is null
      or nullif(row_record.row #>> '{data,order_bump_1_sales}', '') is null
      or nullif(row_record.row #>> '{data,order_bump_2_sales}', '') is null
      or nullif(row_record.row #>> '{data,order_bump_3_sales}', '') is null then
      raise exception 'invalid metric row' using errcode = '22023';
    end if;

    begin
      v_line_number := (row_record.row ->> 'line')::integer;
      v_metric_date := (row_record.row #>> '{data,date}')::date;
      v_investment := (row_record.row #>> '{data,investment}')::numeric;
      v_impressions := (row_record.row #>> '{data,impressions}')::bigint;
      v_clicks := (row_record.row #>> '{data,clicks}')::bigint;
      v_page_views := (row_record.row #>> '{data,page_views}')::bigint;
      v_checkouts := (row_record.row #>> '{data,checkouts}')::bigint;
      v_core_sales := (row_record.row #>> '{data,core_sales}')::bigint;
      v_order_bump_1_sales := (row_record.row #>> '{data,order_bump_1_sales}')::bigint;
      v_order_bump_2_sales := (row_record.row #>> '{data,order_bump_2_sales}')::bigint;
      v_order_bump_3_sales := (row_record.row #>> '{data,order_bump_3_sales}')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
      raise exception 'invalid metric row' using errcode = '22023';
    end;

    if v_line_number <= 1 or v_line_number = any(v_seen_lines) then
      raise exception 'invalid metric row' using errcode = '22023';
    end if;
    if v_metric_date < p_period_start or v_metric_date > p_period_end then
      raise exception 'metric row is outside the declared period' using errcode = '22007';
    end if;
    if v_metric_date = any(v_seen_dates) then
      raise exception 'metric dates must be unique' using errcode = '22023';
    end if;
    if v_investment < 0
      or v_investment in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      or v_impressions < 0 or v_clicks < 0 or v_page_views < 0 or v_checkouts < 0
      or v_core_sales < 0 or v_order_bump_1_sales < 0
      or v_order_bump_2_sales < 0 or v_order_bump_3_sales < 0 then
      raise exception 'metric values must be nonnegative' using errcode = '22023';
    end if;
    v_seen_lines := array_append(v_seen_lines, v_line_number);
    v_seen_dates := array_append(v_seen_dates, v_metric_date);
  end loop;

  v_rows_written := jsonb_array_length(p_file -> 'rows');
  insert into public.metric_imports (
    id, organization_id, project_id, original_filename, storage_path,
    content_sha256, delimiter, headers, period_start, period_end,
    rows_received, imported_by
  ) values (
    v_import_id, p_organization_id, p_project_id, v_filename, v_storage_path,
    v_content_sha256, v_delimiter, p_file -> 'headers', p_period_start, p_period_end,
    v_rows_written, auth.uid()
  )
  on conflict (project_id, content_sha256) do nothing
  returning id into v_existing_id;

  if v_existing_id is null then
    select import.id, import.period_start, import.period_end
    into v_existing_id, v_existing_period_start, v_existing_period_end
    from public.metric_imports import
    where import.project_id = p_project_id
      and import.content_sha256 = v_content_sha256;

    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, metadata
    ) values (
      p_organization_id, auth.uid(), 'project.metrics_imported', 'project', p_project_id::text,
      jsonb_build_object('importId', v_existing_id, 'duplicate', true, 'rowsWritten', 0)
    );

    return jsonb_build_object(
      'id', v_existing_id,
      'duplicate', true,
      'rowsWritten', 0,
      'periodStart', v_existing_period_start::text,
      'periodEnd', v_existing_period_end::text
    );
  end if;

  for row_record in
    select value as row
    from jsonb_array_elements(p_file -> 'rows')
  loop
    insert into public.metric_import_rows (
      organization_id, import_id, line_number, metric_date, raw_values, normalized_values
    ) values (
      p_organization_id, v_import_id, (row_record.row ->> 'line')::integer,
      (row_record.row #>> '{data,date}')::date,
      row_record.row -> 'raw', row_record.row -> 'data'
    );

    insert into public.project_csv_daily_metrics (
      organization_id, project_id, metric_date, investment, impressions, clicks,
      page_views, checkouts, core_sales, order_bump_1_sales,
      order_bump_2_sales, order_bump_3_sales, import_id
    ) values (
      p_organization_id, p_project_id, (row_record.row #>> '{data,date}')::date,
      (row_record.row #>> '{data,investment}')::numeric,
      (row_record.row #>> '{data,impressions}')::bigint,
      (row_record.row #>> '{data,clicks}')::bigint,
      (row_record.row #>> '{data,page_views}')::bigint,
      (row_record.row #>> '{data,checkouts}')::bigint,
      (row_record.row #>> '{data,core_sales}')::bigint,
      (row_record.row #>> '{data,order_bump_1_sales}')::bigint,
      (row_record.row #>> '{data,order_bump_2_sales}')::bigint,
      (row_record.row #>> '{data,order_bump_3_sales}')::bigint,
      v_import_id
    )
    on conflict (project_id, metric_date) do update set
      organization_id = excluded.organization_id,
      investment = excluded.investment,
      impressions = excluded.impressions,
      clicks = excluded.clicks,
      page_views = excluded.page_views,
      checkouts = excluded.checkouts,
      core_sales = excluded.core_sales,
      order_bump_1_sales = excluded.order_bump_1_sales,
      order_bump_2_sales = excluded.order_bump_2_sales,
      order_bump_3_sales = excluded.order_bump_3_sales,
      import_id = excluded.import_id,
      imported_at = now();
  end loop;

  update public.metric_imports
  set status = 'succeeded', rows_written = v_rows_written, completed_at = now()
  where id = v_import_id;

  update public.projects
  set settings = coalesce(settings, '{}'::jsonb)
    || jsonb_build_object(
      'metrics', coalesce(settings -> 'metrics', '{}'::jsonb)
        || jsonb_build_object('periodStart', p_period_start::text, 'periodEnd', p_period_end::text)
    )
  where id = p_project_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, auth.uid(), 'project.metrics_imported', 'project', p_project_id::text,
    jsonb_build_object('importId', v_import_id, 'duplicate', false, 'rowsWritten', v_rows_written)
  );

  return jsonb_build_object(
    'id', v_import_id,
    'duplicate', false,
    'rowsWritten', v_rows_written,
    'periodStart', p_period_start::text,
    'periodEnd', p_period_end::text
  );
end;
$$;

revoke all on function public.import_project_daily_metrics(
  uuid, uuid, jsonb, date, date
) from public, anon, authenticated, service_role;
grant execute on function public.import_project_daily_metrics(
  uuid, uuid, jsonb, date, date
) to authenticated;

revoke insert, update on table public.metricas_trafego from authenticated;
revoke insert, update on table public.metricas_vendas from authenticated;
drop policy if exists legacy_metricas_trafego_admin_insert on public.metricas_trafego;
drop policy if exists legacy_metricas_trafego_admin_update on public.metricas_trafego;
drop policy if exists legacy_metricas_vendas_admin_insert on public.metricas_vendas;
drop policy if exists legacy_metricas_vendas_admin_update on public.metricas_vendas;
revoke execute on function public.import_project_csv_metrics(
  uuid, uuid, jsonb, jsonb, date, date
) from authenticated;
grant execute on function public.import_project_csv_metrics(
  uuid, uuid, jsonb, jsonb, date, date
) to service_role;

alter function public.ingest_hubla_webhook(
  uuid, text, text, text, timestamptz, text, bigint, text, text,
  numeric, numeric, text, boolean, jsonb
) rename to ingest_hubla_webhook_transactional;

create function public.ingest_hubla_webhook(
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
  v_constraint_name text;
begin
  return query
  select result.duplicate, result.mapped, result.normalized
  from public.ingest_hubla_webhook_transactional(
    p_connection_id, p_idempotency_key, p_event_type, p_contract_version,
    p_event_at, p_entity_id, p_entity_version, p_product_external_id,
    p_product_name, p_gross_amount, p_net_amount, p_currency, p_sandbox, p_payload
  ) result;
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = CONSTRAINT_NAME;
    if v_constraint_name <> 'sales_events_approved_transaction_unique' then
      raise;
    end if;
    return query
    select true, event.project_id is not null, false
    from public.sales_events event
    where event.connection_id = p_connection_id
      and event.external_transaction_id = btrim(p_entity_id)
      and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED')
    order by event.event_at desc
    limit 1;
  end;
$$;

revoke all on function public.ingest_hubla_webhook_transactional(
  uuid, text, text, text, timestamptz, text, bigint, text, text,
  numeric, numeric, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.ingest_hubla_webhook(
  uuid, text, text, text, timestamptz, text, bigint, text, text,
  numeric, numeric, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_hubla_webhook(
  uuid, text, text, text, timestamptz, text, bigint, text, text,
  numeric, numeric, text, boolean, jsonb
) to service_role;

create or replace function public.ingest_hotmart_refund(
  p_connection_id uuid,
  p_external_event_id text,
  p_external_transaction_id text,
  p_event_at timestamptz,
  p_gross_amount numeric,
  p_net_amount numeric,
  p_currency text,
  p_payload jsonb default '{}'::jsonb
)
returns table(event_id uuid, duplicate boolean, mapped boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_original_event_id uuid;
  v_original_project_id uuid;
  v_refund_event_id uuid;
begin
  select connection.organization_id into v_organization_id
  from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.provider = 'hotmart'
    and connection.revoked_at is null;
  if v_organization_id is null then
    raise exception 'active Hotmart connection not found';
  end if;
  if nullif(btrim(p_external_event_id), '') is null
    or nullif(btrim(p_external_transaction_id), '') is null
    or p_event_at is null
    or p_gross_amount is null or p_gross_amount < 0
    or p_net_amount is null or p_net_amount < 0
    or p_currency !~ '^[A-Za-z]{3}$'
    or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid Hotmart refund';
  end if;

  select event.id, event.project_id
  into v_refund_event_id, v_original_project_id
  from public.sales_events event
  where event.connection_id = p_connection_id
    and event.external_event_id = btrim(p_external_event_id);
  if v_refund_event_id is not null then
    return query select v_refund_event_id, true, v_original_project_id is not null;
    return;
  end if;

  select event.id, event.project_id
  into v_original_event_id, v_original_project_id
  from public.sales_events event
  where event.connection_id = p_connection_id
    and event.external_transaction_id = btrim(p_external_transaction_id)
    and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED')
  order by event.event_at desc
  limit 1
  for update;
  if v_original_event_id is null then
    raise exception 'original Hotmart sale not found';
  end if;

  -- The original sale lock serializes concurrent retries for this transaction.
  select event.id
  into v_refund_event_id
  from public.sales_events event
  where event.connection_id = p_connection_id
    and event.external_event_id = btrim(p_external_event_id);
  if v_refund_event_id is not null then
    return query select v_refund_event_id, true, v_original_project_id is not null;
    return;
  end if;

  insert into public.sales_events (
    organization_id, project_id, connection_id, external_event_id,
    external_transaction_id, event_type, event_at, gross_amount, net_amount,
    currency, payload, processed_at
  ) values (
    v_organization_id, v_original_project_id, p_connection_id,
    btrim(p_external_event_id), btrim(p_external_transaction_id),
    'PURCHASE_REFUNDED', p_event_at, -p_gross_amount, -p_net_amount,
    upper(p_currency), coalesce(p_payload, '{}'::jsonb),
    case when v_original_project_id is null then null else now() end
  )
  returning id into v_refund_event_id;

  insert into public.sales_event_items (
    organization_id, sales_event_id, product_id, funnel_stage_id,
    product_mapping_id, quantity, gross_amount, net_amount,
    product_name_snapshot, funnel_stage_name_snapshot, stage_type_snapshot
  )
  select item.organization_id, v_refund_event_id, item.product_id,
    item.funnel_stage_id, item.product_mapping_id, item.quantity,
    -abs(coalesce(item.gross_amount, 0)), -abs(coalesce(item.net_amount, 0)),
    item.product_name_snapshot, item.funnel_stage_name_snapshot, item.stage_type_snapshot
  from public.sales_event_items item
  where item.sales_event_id = v_original_event_id;

  return query select v_refund_event_id, false, v_original_project_id is not null;
end;
$$;

revoke all on function public.ingest_hotmart_refund(
  uuid, text, text, timestamptz, numeric, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_hotmart_refund(
  uuid, text, text, timestamptz, numeric, numeric, text, jsonb
) to service_role;

create or replace function public.soft_delete_legacy_project(
  p_organization_id uuid,
  p_slug text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := btrim(coalesce(p_slug, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_project_id uuid;
  v_deleted_at timestamptz;
  v_legacy_exists boolean;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required' using errcode = '42501';
  end if;
  if v_slug = '' or length(v_slug) > 200 then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if v_name = '' then
    v_name := initcap(replace(v_slug, '-', ' '));
  end if;
  if length(v_name) > 120 then
    raise exception 'invalid project name' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.metricas_trafego metric
    where metric.organization_id = p_organization_id and metric.projeto = v_slug
  ) or exists (
    select 1 from public.metricas_vendas metric
    where metric.organization_id = p_organization_id and metric.projeto = v_slug
  ) into v_legacy_exists;

  if not v_legacy_exists and to_regclass('public.mapeamento_produtos') is not null then
    execute format(
      'select exists (select 1 from %I.%I where organization_id = $1 and projeto = $2)',
      'public', 'mapeamento_produtos'
    ) into v_legacy_exists using p_organization_id, v_slug;
  end if;
  if not v_legacy_exists then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  v_deleted_at := clock_timestamp();
  insert into public.projects (
    organization_id, name, slug, status, deleted_at, settings
  ) values (
    p_organization_id, v_name, v_slug, 'archived', v_deleted_at,
    jsonb_build_object('legacy_tombstone', true)
  )
  on conflict (organization_id, slug) do nothing
  returning id into v_project_id;

  if v_project_id is null then
    select project.id into v_project_id
    from public.projects project
    where project.organization_id = p_organization_id
      and project.slug = v_slug
      and project.deleted_at is null
    for update;
    if not found then
      raise exception 'project not found' using errcode = 'P0002';
    end if;
    return public.soft_delete_project(p_organization_id, v_project_id);
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, auth.uid(), 'project.deleted', 'project', v_project_id::text,
    jsonb_build_object('name', v_name, 'slug', v_slug, 'legacy', true)
  );
  return jsonb_build_object('id', v_project_id, 'name', v_name, 'deletedAt', v_deleted_at);
end;
$$;

revoke all on function public.soft_delete_legacy_project(uuid, text, text)
from public, anon, service_role;
grant execute on function public.soft_delete_legacy_project(uuid, text, text)
to authenticated;
