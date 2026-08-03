create table if not exists public.metricas_trafego (
  id uuid primary key default gen_random_uuid(),
  projeto text not null,
  date date not null,
  invest numeric default 0,
  impressions integer default 0,
  clicks integer default 0,
  pageviews integer default 0,
  checkouts integer default 0,
  created_at timestamptz default now(),
  organization_id uuid references public.organizations(id) on delete set null
);

create table if not exists public.metricas_vendas (
  id uuid primary key default gen_random_uuid(),
  projeto text not null,
  date date not null,
  core integer default 0,
  ob1 integer default 0,
  ob2 integer default 0,
  ob3 integer default 0,
  ob4 integer default 0,
  ob5 integer default 0,
  up1 integer default 0,
  up2 integer default 0,
  ds1 integer default 0,
  ds2 integer default 0,
  created_at timestamptz default now(),
  fat_liquido numeric default 0,
  organization_id uuid references public.organizations(id) on delete set null
);

alter table public.metricas_trafego
  drop constraint if exists metricas_trafego_projeto_date_key,
  drop constraint if exists unique_projeto_date;
alter table public.metricas_vendas
  drop constraint if exists metricas_vendas_projeto_date_key;

alter table public.metricas_trafego
  add constraint metricas_trafego_organization_projeto_date_key
  unique (organization_id, projeto, date);
alter table public.metricas_vendas
  add constraint metricas_vendas_organization_projeto_date_key
  unique (organization_id, projeto, date);

alter table public.metricas_trafego enable row level security;
alter table public.metricas_vendas enable row level security;

revoke all on table public.metricas_trafego from public, anon, authenticated;
revoke all on table public.metricas_vendas from public, anon, authenticated;
grant select, insert, update on table public.metricas_trafego to authenticated;
grant select, insert, update on table public.metricas_vendas to authenticated;

drop policy if exists legacy_metricas_trafego_read on public.metricas_trafego;
drop policy if exists legacy_metricas_trafego_admin_insert on public.metricas_trafego;
drop policy if exists legacy_metricas_trafego_admin_update on public.metricas_trafego;
create policy legacy_metricas_trafego_read on public.metricas_trafego
for select to authenticated
using (organization_id is not null and public.is_org_member(organization_id));
create policy legacy_metricas_trafego_admin_insert on public.metricas_trafego
for insert to authenticated
with check (organization_id is not null and public.is_org_admin(organization_id));
create policy legacy_metricas_trafego_admin_update on public.metricas_trafego
for update to authenticated
using (organization_id is not null and public.is_org_admin(organization_id))
with check (organization_id is not null and public.is_org_admin(organization_id));

drop policy if exists legacy_metricas_vendas_read on public.metricas_vendas;
drop policy if exists legacy_metricas_vendas_admin_insert on public.metricas_vendas;
drop policy if exists legacy_metricas_vendas_admin_update on public.metricas_vendas;
create policy legacy_metricas_vendas_read on public.metricas_vendas
for select to authenticated
using (organization_id is not null and public.is_org_member(organization_id));
create policy legacy_metricas_vendas_admin_insert on public.metricas_vendas
for insert to authenticated
with check (organization_id is not null and public.is_org_admin(organization_id));
create policy legacy_metricas_vendas_admin_update on public.metricas_vendas
for update to authenticated
using (organization_id is not null and public.is_org_admin(organization_id))
with check (organization_id is not null and public.is_org_admin(organization_id));

create or replace function public.import_project_csv_metrics(
  p_organization_id uuid,
  p_project_id uuid,
  p_traffic jsonb,
  p_sales jsonb,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slug text;
  v_traffic_count integer := 0;
  v_sales_count integer := 0;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'administrator permission required' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null
    or p_period_start > p_period_end
    or p_period_end - p_period_start > 365 then
    raise exception 'invalid metrics period' using errcode = '22007';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_traffic, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_sales, '[]'::jsonb)) <> 'array' then
    raise exception 'metrics payload must contain arrays' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(coalesce(p_traffic, '[]'::jsonb))
    + pg_catalog.jsonb_array_length(coalesce(p_sales, '[]'::jsonb)) = 0 then
    raise exception 'metrics payload is empty' using errcode = '22023';
  end if;

  select project.slug
  into v_slug
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  insert into public.metricas_trafego (
    organization_id,
    projeto,
    date,
    invest,
    impressions,
    clicks,
    pageviews,
    checkouts
  )
  select
    p_organization_id,
    v_slug,
    metric.date,
    coalesce(metric.invest, 0),
    coalesce(metric.impressions, 0),
    coalesce(metric.clicks, 0),
    coalesce(metric.pageviews, 0),
    coalesce(metric.checkouts, 0)
  from pg_catalog.jsonb_to_recordset(coalesce(p_traffic, '[]'::jsonb))
    as metric(
      date date,
      invest numeric,
      impressions integer,
      clicks integer,
      pageviews integer,
      checkouts integer
    )
  on conflict (organization_id, projeto, date) do update set
    invest = excluded.invest,
    impressions = excluded.impressions,
    clicks = excluded.clicks,
    pageviews = excluded.pageviews,
    checkouts = excluded.checkouts;
  get diagnostics v_traffic_count = row_count;

  insert into public.metricas_vendas (
    organization_id,
    projeto,
    date,
    core,
    ob1,
    ob2,
    ob3,
    ob4,
    ob5,
    up1,
    up2,
    ds1,
    ds2,
    fat_liquido
  )
  select
    p_organization_id,
    v_slug,
    metric.date,
    coalesce(metric.core, 0),
    coalesce(metric.ob1, 0),
    coalesce(metric.ob2, 0),
    coalesce(metric.ob3, 0),
    coalesce(metric.ob4, 0),
    coalesce(metric.ob5, 0),
    coalesce(metric.up1, 0),
    coalesce(metric.up2, 0),
    coalesce(metric.ds1, 0),
    coalesce(metric.ds2, 0),
    coalesce(metric.fat_liquido, 0)
  from pg_catalog.jsonb_to_recordset(coalesce(p_sales, '[]'::jsonb))
    as metric(
      date date,
      core integer,
      ob1 integer,
      ob2 integer,
      ob3 integer,
      ob4 integer,
      ob5 integer,
      up1 integer,
      up2 integer,
      ds1 integer,
      ds2 integer,
      fat_liquido numeric
    )
  on conflict (organization_id, projeto, date) do update set
    core = excluded.core,
    ob1 = excluded.ob1,
    ob2 = excluded.ob2,
    ob3 = excluded.ob3,
    ob4 = excluded.ob4,
    ob5 = excluded.ob5,
    up1 = excluded.up1,
    up2 = excluded.up2,
    ds1 = excluded.ds1,
    ds2 = excluded.ds2,
    fat_liquido = excluded.fat_liquido;
  get diagnostics v_sales_count = row_count;

  update public.projects
  set settings = coalesce(settings, '{}'::jsonb)
    || pg_catalog.jsonb_build_object(
      'metrics',
      coalesce(settings -> 'metrics', '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'periodStart', p_period_start::text,
          'periodEnd', p_period_end::text
        )
    )
  where id = p_project_id
    and organization_id = p_organization_id;

  return pg_catalog.jsonb_build_object(
    'trafficRows', v_traffic_count,
    'salesRows', v_sales_count,
    'periodStart', p_period_start::text,
    'periodEnd', p_period_end::text
  );
end;
$$;

revoke all on function public.import_project_csv_metrics(
  uuid,
  uuid,
  jsonb,
  jsonb,
  date,
  date
) from public, anon, authenticated;
grant execute on function public.import_project_csv_metrics(
  uuid,
  uuid,
  jsonb,
  jsonb,
  date,
  date
) to authenticated;
