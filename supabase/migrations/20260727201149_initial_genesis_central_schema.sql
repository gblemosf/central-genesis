create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists btree_gist with schema extensions;

do $preflight$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'PostgreSQL 15 or newer is required';
  end if;
end;
$preflight$;

create type public.organization_role as enum ('owner', 'admin', 'operator', 'viewer');
create type public.project_status as enum ('draft', 'active', 'paused', 'archived');
create type public.integration_provider as enum ('meta', 'hotmart', 'eduzz', 'kiwify', 'hubla');
create type public.connection_status as enum ('connected', 'attention', 'disconnected', 'revoked');
create type public.funnel_stage_type as enum (
  'core', 'order_bump', 'upsell', 'downsell',
  'low_ticket', 'front_end', 'middle_end', 'back_end'
);
create type public.sync_status as enum ('queued', 'running', 'succeeded', 'failed');

-- The connected Genesis project already has an empty organizations table from
-- an unfinished CRM module. Reuse it to avoid breaking its foreign keys.
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.organizations
  add column if not exists updated_at timestamptz not null default now();

do $migration$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'organizations'
  loop
    execute pg_catalog.format(
      'drop policy %I on public.organizations',
      existing_policy.policyname
    );
  end loop;
end;
$migration$;

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  unique (user_id)
);

create table public.experts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expert_id uuid,
  name text not null,
  slug text not null,
  status public.project_status not null default 'draft',
  color text not null default '#61d6c8',
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  reporting_timezone text not null default 'America/Sao_Paulo',
  monthly_revenue_target numeric(14,2) not null default 0,
  margin_target numeric(6,2) not null default 0,
  settings jsonb not null default '{}'::jsonb,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, id),
  foreign key (organization_id, expert_id)
    references public.experts(organization_id, id)
    on delete set null (expert_id)
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  provider public.integration_provider not null,
  status public.connection_status not null default 'disconnected',
  business_id text,
  app_id text,
  system_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.integration_secrets (
  connection_id uuid primary key references public.integration_connections(id) on delete cascade,
  vault_secret_id uuid not null unique,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

create table public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  external_id text not null,
  name text not null,
  account_type text,
  currency text,
  timezone text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id),
  unique (organization_id, id),
  foreign key (organization_id, connection_id)
    references public.integration_connections(organization_id, id)
    on delete cascade
);

create table public.project_accounts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  provider_account_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (project_id, provider_account_id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, provider_account_id)
    references public.provider_accounts(organization_id, id)
    on delete cascade
);

create unique index project_accounts_one_primary
  on public.project_accounts (project_id)
  where is_primary;

create unique index project_accounts_account_unique
  on public.project_accounts (provider_account_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  external_id text not null,
  name text not null,
  current_price numeric(14,2),
  currency text not null default 'BRL',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id),
  unique (organization_id, id),
  foreign key (organization_id, connection_id)
    references public.integration_connections(organization_id, id)
    on delete cascade
);

create table public.funnel_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  name text not null,
  stage_type public.funnel_stage_type not null,
  position integer not null check (position > 0),
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, position),
  unique (project_id, id),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete cascade
);

create table public.product_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  product_id uuid not null,
  funnel_stage_id uuid not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
    on delete cascade,
  foreign key (organization_id, funnel_stage_id)
    references public.funnel_stages(organization_id, id)
    on delete cascade,
  foreign key (project_id, funnel_stage_id)
    references public.funnel_stages(project_id, id)
    on delete cascade
);

create unique index product_mappings_active_unique
  on public.product_mappings (product_id)
  where effective_to is null;

alter table public.product_mappings
  add constraint product_mappings_no_overlap
  exclude using gist (
    product_id with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  );

create table public.traffic_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  provider_account_id uuid,
  metric_date date not null,
  investment numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  page_views bigint not null default 0,
  checkouts bigint not null default 0,
  source text not null default 'meta',
  is_estimated boolean not null default false,
  synced_at timestamptz not null default now(),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, provider_account_id)
    references public.provider_accounts(organization_id, id)
    on delete set null (provider_account_id),
  foreign key (project_id, provider_account_id)
    references public.project_accounts(project_id, provider_account_id)
    on delete set null (provider_account_id)
);

create unique index traffic_metrics_daily_identity_unique
  on public.traffic_metrics_daily (project_id, provider_account_id, metric_date)
  nulls not distinct;

create table public.sales_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  connection_id uuid not null,
  external_event_id text not null,
  external_transaction_id text,
  event_type text not null,
  event_at timestamptz not null,
  gross_amount numeric(14,2),
  net_amount numeric(14,2),
  currency text not null default 'BRL',
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, external_event_id),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete set null (project_id),
  foreign key (organization_id, connection_id)
    references public.integration_connections(organization_id, id)
    on delete cascade
);

create table public.sales_event_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sales_event_id uuid not null,
  product_id uuid,
  funnel_stage_id uuid,
  quantity integer not null default 1 check (quantity > 0),
  gross_amount numeric(14,2),
  net_amount numeric(14,2),
  created_at timestamptz not null default now(),
  unique (sales_event_id, product_id),
  foreign key (organization_id, sales_event_id)
    references public.sales_events(organization_id, id)
    on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
    on delete set null (product_id),
  foreign key (organization_id, funnel_stage_id)
    references public.funnel_stages(organization_id, id)
    on delete set null (funnel_stage_id)
);

create table public.project_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  cost_date date not null,
  name text not null,
  amount numeric(14,2) not null,
  recurring boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete cascade
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  connection_id uuid,
  job_type text not null,
  status public.sync_status not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  records_processed integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id)
    on delete cascade,
  foreign key (organization_id, connection_id)
    references public.integration_connections(organization_id, id)
    on delete cascade
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index organization_members_user_idx on public.organization_members(user_id);
create index experts_organization_idx on public.experts(organization_id);
create index projects_organization_idx on public.projects(organization_id);
create index connections_organization_idx on public.integration_connections(organization_id);
create index provider_accounts_connection_idx on public.provider_accounts(connection_id);
create index products_connection_idx on public.products(connection_id);
create index traffic_metrics_project_date_idx on public.traffic_metrics_daily(project_id, metric_date desc);
create index sales_events_project_date_idx on public.sales_events(project_id, event_at desc);
create index sales_events_transaction_idx on public.sales_events(connection_id, external_transaction_id);
create unique index sales_events_approved_transaction_unique
  on public.sales_events (connection_id, external_transaction_id)
  where external_transaction_id is not null
    and event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED');
create index sync_runs_connection_date_idx on public.sync_runs(connection_id, created_at desc);
create index audit_events_organization_date_idx on public.audit_events(organization_id, created_at desc);

create view public.project_daily_metrics
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
      pg_catalog.sum(item.quantity) filter (where stage.stage_type = 'core'),
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

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create or replace function public.keep_membership_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id then
    raise exception 'membership identity cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.keep_membership_identity()
  from public, anon, authenticated;

create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
create trigger organization_members_keep_identity before update on public.organization_members
for each row execute function public.keep_membership_identity();
create trigger experts_set_updated_at before update on public.experts
for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
for each row execute function public.set_updated_at();
create trigger integration_connections_set_updated_at before update on public.integration_connections
for each row execute function public.set_updated_at();
create trigger provider_accounts_set_updated_at before update on public.provider_accounts
for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger funnel_stages_set_updated_at before update on public.funnel_stages
for each row execute function public.set_updated_at();

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = auth.uid()
      and member.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- Legacy tables are optional on clean installations. Existing history is
-- assigned during bootstrap and remains readable only inside its organization.
do $legacy$
declare
  relation_name text;
  constraint_name text;
  policy_name text;
  existing_policy record;
begin
  foreach relation_name in array array[
    'metricas_trafego', 'metricas_vendas', 'mapeamento_produtos'
  ]
  loop
    if pg_catalog.to_regclass('public.' || relation_name) is not null then
      execute pg_catalog.format(
        'alter table public.%I add column if not exists organization_id uuid',
        relation_name
      );

      constraint_name := relation_name || '_organization_id_fkey';
      if not exists (
        select 1
        from pg_catalog.pg_constraint
        where conname = constraint_name
          and conrelid = pg_catalog.to_regclass('public.' || relation_name)
      ) then
        execute pg_catalog.format(
          'alter table public.%I add constraint %I foreign key (organization_id) references public.organizations(id) on delete set null',
          relation_name,
          constraint_name
        );
      end if;

      for existing_policy in
        select policyname
        from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = relation_name
      loop
        execute pg_catalog.format(
          'drop policy %I on public.%I',
          existing_policy.policyname,
          relation_name
        );
      end loop;

      execute pg_catalog.format(
        'revoke all privileges on table public.%I from public, anon, authenticated',
        relation_name
      );
      execute pg_catalog.format(
        'grant select on table public.%I to authenticated',
        relation_name
      );
      execute pg_catalog.format(
        'alter table public.%I enable row level security',
        relation_name
      );

      policy_name := 'legacy_' || relation_name || '_read';
      execute pg_catalog.format(
        'create policy %I on public.%I for select to authenticated using (organization_id is not null and public.is_org_member(organization_id))',
        policy_name,
        relation_name
      );
    end if;
  end loop;

  if pg_catalog.to_regclass('public.dashboard_roi') is not null then
    execute 'alter view public.dashboard_roi set (security_invoker = true)';
    execute 'revoke all privileges on table public.dashboard_roi from public, anon, authenticated';
  end if;
end;
$legacy$;

-- The unused CRM prototype contains permissive policies. Keep its schema, but
-- remove client access until dedicated tenant policies are implemented.
do $legacy_crm$
declare
  relation_name text;
  existing_policy record;
begin
  foreach relation_name in array array[
    'agents', 'instagram_accounts', 'labels', 'lead_labels', 'leads',
    'messages', 'quick_replies', 'ticket_history', 'ticket_labels', 'tickets',
    'conversations', 'manychat_accounts', 'manychat_events'
  ]
  loop
    if pg_catalog.to_regclass('public.' || relation_name) is not null then
      for existing_policy in
        select policyname
        from pg_catalog.pg_policies
        where schemaname = 'public' and tablename = relation_name
      loop
        execute pg_catalog.format(
          'drop policy %I on public.%I',
          existing_policy.policyname,
          relation_name
        );
      end loop;
      execute pg_catalog.format(
        'revoke all privileges on table public.%I from public, anon, authenticated',
        relation_name
      );
    end if;
  end loop;
end;
$legacy_crm$;

create or replace function public.bootstrap_organization(
  p_user_id uuid,
  organization_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  legacy_relation text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.bootstrap_organization', 0)
  );

  if exists (select 1 from public.organization_members where user_id = p_user_id) then
    select om.organization_id into v_organization_id
    from public.organization_members om
    where om.user_id = p_user_id
    limit 1;
    return v_organization_id;
  end if;
  if exists (select 1 from public.organizations) then
    raise exception 'organization already initialized';
  end if;

  insert into public.organizations (name)
  values (organization_name)
  returning id into v_organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, p_user_id, 'owner');

  for legacy_relation in
    select class.relname::text
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = any(array[
        'metricas_trafego', 'metricas_vendas', 'mapeamento_produtos'
      ]::text[])
  loop
    execute pg_catalog.format(
      'update public.%I set organization_id = $1 where organization_id is null',
      legacy_relation
    ) using v_organization_id;
  end loop;

  return v_organization_id;
end;
$$;

revoke all on function public.bootstrap_organization(uuid, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_organization(uuid, text) to service_role;

create or replace function public.create_project_with_defaults(
  p_organization_id uuid,
  p_name text,
  p_slug text,
  p_expert_name text,
  p_expert_email text,
  p_sales_provider text,
  p_monthly_target numeric,
  p_margin_target numeric,
  p_meta_connection_id uuid default null,
  p_meta_account_external_id text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_expert_id uuid;
  v_project_id uuid;
  v_provider_account_id uuid;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;

  insert into public.experts (organization_id, name, email)
  values (p_organization_id, p_expert_name, p_expert_email)
  returning id into v_expert_id;

  insert into public.projects (
    organization_id, expert_id, name, slug, status,
    monthly_revenue_target, margin_target, settings
  )
  values (
    p_organization_id, v_expert_id, p_name, p_slug, 'draft',
    p_monthly_target, p_margin_target,
    pg_catalog.jsonb_build_object('sales_provider', p_sales_provider)
  )
  returning id into v_project_id;

  insert into public.funnel_stages (
    organization_id, project_id, name, stage_type, position
  )
  values
    (p_organization_id, v_project_id, 'Produto core', 'core', 1),
    (p_organization_id, v_project_id, 'Order bump', 'order_bump', 2),
    (p_organization_id, v_project_id, 'Upsell', 'upsell', 3),
    (p_organization_id, v_project_id, 'Downsell', 'downsell', 4);

  if p_meta_connection_id is not null and p_meta_account_external_id is not null then
    select account.id into v_provider_account_id
    from public.provider_accounts account
    join public.integration_connections connection
      on connection.id = account.connection_id
    where account.organization_id = p_organization_id
      and account.connection_id = p_meta_connection_id
      and account.external_id = p_meta_account_external_id
      and account.account_type = 'meta_ad_account'
      and account.is_active
      and account.currency = 'BRL'
      and account.timezone = 'America/Sao_Paulo'
      and connection.provider = 'meta';

    if v_provider_account_id is null then
      raise exception 'active Meta account not found';
    end if;

    insert into public.project_accounts (
      organization_id, project_id, provider_account_id, is_primary
    )
    values (p_organization_id, v_project_id, v_provider_account_id, true);
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_project_id,
    'name', p_name,
    'slug', p_slug,
    'status', 'draft'
  );
end;
$$;

revoke all on function public.create_project_with_defaults(
  uuid, text, text, text, text, text, numeric, numeric, uuid, text
) from public, anon;
grant execute on function public.create_project_with_defaults(
  uuid, text, text, text, text, text, numeric, numeric, uuid, text
) to authenticated;

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
  v_product_currency text;
  v_project_currency text;
  v_current_mapping_id uuid;
  v_current_project_id uuid;
  v_current_stage_id uuid;
  v_effective_from timestamptz;
  v_has_history boolean;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;
  select project.currency into v_project_currency
  from public.projects project
    where project.id = p_project_id
      and project.organization_id = p_organization_id;
  if v_project_currency is null then
    raise exception 'project not found';
  end if;
  if pg_catalog.jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'mappings must be an array';
  end if;

  update public.product_mappings mapping
  set effective_to = now()
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
    select product.connection_id, product.external_id, product.currency
    into v_connection_id, v_external_id, v_product_currency
    from public.products product
    where product.id = requested.product_id
      and product.organization_id = p_organization_id;
    if not found then
      raise exception 'product not found';
    end if;
    if v_product_currency <> v_project_currency then
      raise exception 'product currency does not match project currency';
    end if;
    if not exists (
      select 1 from public.funnel_stages stage
      where stage.id = requested.funnel_stage_id
        and stage.organization_id = p_organization_id
        and stage.project_id = p_project_id
    ) then
      raise exception 'funnel stage not found';
    end if;

    v_current_mapping_id := null;
    v_current_project_id := null;
    v_current_stage_id := null;
    v_effective_from := null;
    select mapping.id, mapping.project_id, mapping.funnel_stage_id, mapping.effective_from
    into v_current_mapping_id, v_current_project_id, v_current_stage_id, v_effective_from
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
        when v_has_history then now()
        else pg_catalog.to_timestamp(0)
      end;
      insert into public.product_mappings (
        organization_id,
        project_id,
        product_id,
        funnel_stage_id,
        effective_from,
        created_by
      )
      values (
        p_organization_id,
        p_project_id,
        requested.product_id,
        requested.funnel_stage_id,
        v_effective_from,
        auth.uid()
      );
    elsif v_current_project_id <> p_project_id
      or v_current_stage_id <> requested.funnel_stage_id then
      update public.product_mappings
      set effective_to = now()
      where id = v_current_mapping_id;

      v_effective_from := now();
      insert into public.product_mappings (
        organization_id,
        project_id,
        product_id,
        funnel_stage_id,
        effective_from,
        created_by
      )
      values (
        p_organization_id,
        p_project_id,
        requested.product_id,
        requested.funnel_stage_id,
        v_effective_from,
        auth.uid()
      );
    end if;

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
        organization_id,
        sales_event_id,
        product_id,
        funnel_stage_id,
        gross_amount,
        net_amount
      )
      values (
        p_organization_id,
        pending_event.id,
        requested.product_id,
        requested.funnel_stage_id,
        pending_event.gross_amount,
        pending_event.net_amount
      )
      on conflict (sales_event_id, product_id) do nothing;
    end loop;
  end loop;
end;
$$;

revoke all on function public.replace_project_product_mappings(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.replace_project_product_mappings(uuid, uuid, jsonb)
  to authenticated;

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
  if not exists (
    select 1 from public.projects project
    where project.id = p_project_id
      and project.organization_id = p_organization_id
  ) then
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
  ) then
    raise exception 'active Meta account not found';
  end if;

  delete from public.project_accounts link
  where link.organization_id = p_organization_id
    and link.project_id = p_project_id;

  if p_provider_account_id is not null then
    insert into public.project_accounts (
      organization_id, project_id, provider_account_id, is_primary
    )
    values (p_organization_id, p_project_id, p_provider_account_id, true);
  end if;
end;
$$;

revoke all on function public.set_project_meta_account(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.set_project_meta_account(uuid, uuid, uuid)
  to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.experts enable row level security;
alter table public.projects enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_secrets enable row level security;
alter table public.provider_accounts enable row level security;
alter table public.project_accounts enable row level security;
alter table public.products enable row level security;
alter table public.funnel_stages enable row level security;
alter table public.product_mappings enable row level security;
alter table public.traffic_metrics_daily enable row level security;
alter table public.sales_events enable row level security;
alter table public.sales_event_items enable row level security;
alter table public.project_costs enable row level security;
alter table public.sync_runs enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_read on public.organizations
for select to authenticated using (public.is_org_member(id));
create policy organizations_update on public.organizations
for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy members_read on public.organization_members
for select to authenticated using (public.is_org_member(organization_id));
create policy members_insert on public.organization_members
for insert to authenticated with check (
  public.is_org_admin(organization_id) and role <> 'owner'
);
create policy members_update on public.organization_members
for update to authenticated using (
  public.is_org_admin(organization_id)
  and role <> 'owner'
  and user_id <> auth.uid()
) with check (
  public.is_org_admin(organization_id) and role <> 'owner'
);
create policy members_delete on public.organization_members
for delete to authenticated using (
  public.is_org_admin(organization_id)
  and role <> 'owner'
  and user_id <> auth.uid()
);

create policy experts_read on public.experts
for select to authenticated using (public.is_org_member(organization_id));
create policy experts_write on public.experts
for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy projects_read on public.projects
for select to authenticated using (public.is_org_member(organization_id));
create policy projects_write on public.projects
for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy connections_read on public.integration_connections
for select to authenticated using (public.is_org_member(organization_id));
create policy connections_write on public.integration_connections
for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy accounts_read on public.provider_accounts
for select to authenticated using (public.is_org_member(organization_id));
create policy accounts_write on public.provider_accounts
for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy project_accounts_read on public.project_accounts
for select to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_member(p.organization_id))
);
create policy project_accounts_write on public.project_accounts
for all to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
);

create policy products_read on public.products
for select to authenticated using (public.is_org_member(organization_id));
create policy products_write on public.products
for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy funnel_stages_read on public.funnel_stages
for select to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_member(p.organization_id))
);
create policy funnel_stages_write on public.funnel_stages
for all to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
);

create policy product_mappings_read on public.product_mappings
for select to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_member(p.organization_id))
);
create policy product_mappings_write on public.product_mappings
for all to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
);

create policy traffic_metrics_read on public.traffic_metrics_daily
for select to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_member(p.organization_id))
);
create policy traffic_metrics_write on public.traffic_metrics_daily
for all to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
);

create policy sales_events_read on public.sales_events
for select to authenticated using (public.is_org_member(organization_id));
create policy sales_events_write on public.sales_events
for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy sales_items_read on public.sales_event_items
for select to authenticated using (
  exists (
    select 1 from public.sales_events e
    where e.id = sales_event_id and public.is_org_member(e.organization_id)
  )
);

create policy project_costs_read on public.project_costs
for select to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_member(p.organization_id))
);
create policy project_costs_write on public.project_costs
for all to authenticated using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_id and public.is_org_admin(p.organization_id))
);

create policy sync_runs_read on public.sync_runs
for select to authenticated using (public.is_org_member(organization_id));
create policy sync_runs_write on public.sync_runs
for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy audit_events_read on public.audit_events
for select to authenticated using (public.is_org_admin(organization_id));

revoke all on public.integration_secrets from anon, authenticated;
grant select, insert, update, delete on public.integration_secrets to service_role;

create or replace function public.set_connection_secret(p_connection_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
  new_secret_id uuid;
begin
  perform 1
  from public.integration_connections
  where id = p_connection_id
  for update;
  if not found then
    raise exception 'connection not found';
  end if;

  select vault_secret_id into existing_secret_id
  from public.integration_secrets
  where connection_id = p_connection_id
  for update;

  if existing_secret_id is not null
    and not exists (select 1 from vault.secrets where id = existing_secret_id) then
    delete from public.integration_secrets
    where connection_id = p_connection_id;
    existing_secret_id := null;
  end if;

  if existing_secret_id is null then
    select vault.create_secret(
      p_secret,
      'integration-' || p_connection_id::text,
      'Credential managed by Central de Gestao Genesis'
    ) into new_secret_id;

    insert into public.integration_secrets (connection_id, vault_secret_id)
    values (p_connection_id, new_secret_id);
  else
    perform vault.update_secret(existing_secret_id, p_secret);
    update public.integration_secrets
    set rotated_at = now()
    where connection_id = p_connection_id;
  end if;

  update public.integration_connections
  set status = 'attention',
      revoked_at = null,
      last_verified_at = null,
      last_error = null
  where id = p_connection_id;
end;
$$;

create or replace function public.cleanup_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$$;

revoke all on function public.cleanup_vault_secret()
  from public, anon, authenticated;

create trigger integration_secrets_cleanup_vault
after delete on public.integration_secrets
for each row execute function public.cleanup_vault_secret();

create or replace function public.create_connection_with_secret(
  p_organization_id uuid,
  p_name text,
  p_provider text,
  p_credential text,
  p_business_id text default null,
  p_app_id text default null,
  p_system_user_id text default null
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
  if pg_catalog.length(p_credential) not between 8 and 16384 then
    raise exception 'invalid credential';
  end if;

  insert into public.integration_connections (
    organization_id,
    name,
    provider,
    business_id,
    app_id,
    system_user_id
  )
  values (
    p_organization_id,
    pg_catalog.btrim(p_name),
    p_provider::public.integration_provider,
    p_business_id,
    p_app_id,
    p_system_user_id
  )
  returning id into v_connection_id;

  perform public.set_connection_secret(v_connection_id, p_credential);
  return pg_catalog.jsonb_build_object(
    'id', v_connection_id,
    'name', pg_catalog.btrim(p_name),
    'provider', p_provider,
    'status', 'attention',
    'business_id', p_business_id,
    'last_verified_at', null
  );
end;
$$;

create or replace function public.get_connection_secret(p_connection_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted.decrypted_secret
  from public.integration_secrets stored
  join vault.decrypted_secrets decrypted on decrypted.id = stored.vault_secret_id
  where stored.connection_id = p_connection_id;
$$;

create or replace function public.delete_connection_secret(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.integration_connections
  where id = p_connection_id
  for update;
  if not found then
    raise exception 'connection not found';
  end if;

  delete from public.integration_secrets
  where connection_id = p_connection_id;

  update public.integration_connections
  set status = 'revoked',
      revoked_at = now(),
      last_verified_at = null
  where id = p_connection_id;
end;
$$;

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
  v_project_id uuid;
  v_stage_id uuid;
  v_event_id uuid;
  v_result_project_id uuid;
  v_existing_event_type text;
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

  select event.id, event.project_id, event.event_type
  into v_event_id, v_result_project_id, v_existing_event_type
  from public.sales_events event
  where event.connection_id = p_connection_id
    and (
      event.external_event_id = p_external_event_id
      or event.external_transaction_id = p_external_transaction_id
    )
  order by event.created_at
  limit 1;

  if v_event_id is not null
    and v_existing_event_type = 'PURCHASE_COMPLETED'
    and p_event_type = 'PURCHASE_APPROVED' then
    return query select v_event_id, true, v_result_project_id is not null;
    return;
  end if;

  insert into public.products (
    organization_id,
    connection_id,
    external_id,
    name,
    current_price,
    currency
  )
  values (
    v_organization_id,
    p_connection_id,
    p_product_external_id,
    coalesce(nullif(pg_catalog.btrim(p_product_name), ''), p_product_external_id),
    p_gross_amount,
    pg_catalog.upper(p_currency)
  )
  on conflict (connection_id, external_id) do update
  set name = excluded.name,
      current_price = excluded.current_price,
      currency = excluded.currency,
      is_active = true
  returning id into v_product_id;

  select mapping.project_id, mapping.funnel_stage_id
  into v_project_id, v_stage_id
  from public.product_mappings mapping
  join public.projects project on project.id = mapping.project_id
  where mapping.organization_id = v_organization_id
    and mapping.product_id = v_product_id
    and mapping.effective_from <= p_event_at
    and (mapping.effective_to is null or mapping.effective_to > p_event_at)
    and project.currency = pg_catalog.upper(p_currency)
  order by mapping.effective_from desc
  limit 1;

  begin
    insert into public.sales_events (
      organization_id,
      project_id,
      connection_id,
      external_event_id,
      external_transaction_id,
      event_type,
      event_at,
      gross_amount,
      net_amount,
      currency,
      payload,
      processed_at
    )
    values (
      v_organization_id,
      v_project_id,
      p_connection_id,
      p_external_event_id,
      p_external_transaction_id,
      p_event_type,
      p_event_at,
      p_gross_amount,
      p_net_amount,
      pg_catalog.upper(p_currency),
      p_payload,
      case when v_project_id is null then null else now() end
    )
    returning id into v_event_id;
  exception when unique_violation then
    select event.id, event.project_id, event.event_type
    into v_event_id, v_result_project_id, v_existing_event_type
    from public.sales_events event
    where event.connection_id = p_connection_id
      and (
        event.external_event_id = p_external_event_id
        or (
          p_external_transaction_id is not null
          and event.external_transaction_id = p_external_transaction_id
          and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED')
        )
      )
    order by event.created_at
    limit 1;

    if v_event_id is null then
      raise;
    end if;

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
        payload = p_payload,
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
        organization_id,
        sales_event_id,
        product_id,
        funnel_stage_id,
        quantity,
        gross_amount,
        net_amount
      )
      values (
        v_organization_id,
        v_event_id,
        v_product_id,
        v_stage_id,
        1,
        p_gross_amount,
        p_net_amount
      );
    end if;

    return query
    select v_event_id, true, v_result_project_id is not null;
    return;
  end;

  if v_project_id is not null then
    insert into public.sales_event_items (
      organization_id,
      sales_event_id,
      product_id,
      funnel_stage_id,
      quantity,
      gross_amount,
      net_amount
    )
    values (
      v_organization_id,
      v_event_id,
      v_product_id,
      v_stage_id,
      1,
      p_gross_amount,
      p_net_amount
    );
  end if;

  return query select v_event_id, false, v_project_id is not null;
end;
$$;

create or replace function public.replace_meta_metrics(
  p_organization_id uuid,
  p_project_id uuid,
  p_since date,
  p_until date,
  p_provider_account_ids uuid[],
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_accounts integer;
  v_linked_accounts integer;
  v_processed integer;
  v_project_currency text;
begin
  if p_since > p_until or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid Meta sync range or rows';
  end if;

  select project.currency into v_project_currency
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id;
  if v_project_currency is null then
    raise exception 'project not found';
  end if;

  select pg_catalog.count(distinct account_id)
  into v_expected_accounts
  from pg_catalog.unnest(p_provider_account_ids) account_id;

  select pg_catalog.count(*)
  into v_linked_accounts
  from public.project_accounts link
  join public.provider_accounts account on account.id = link.provider_account_id
  where link.organization_id = p_organization_id
    and link.project_id = p_project_id
    and link.provider_account_id = any(p_provider_account_ids)
    and account.is_active
    and account.account_type = 'meta_ad_account'
    and account.currency = v_project_currency
    and account.timezone = (
      select project.reporting_timezone from public.projects project
      where project.id = p_project_id
    );

  if v_expected_accounts = 0 or v_linked_accounts <> v_expected_accounts then
    raise exception 'invalid or unlinked Meta account';
  end if;

  delete from public.traffic_metrics_daily metric
  where metric.organization_id = p_organization_id
    and metric.project_id = p_project_id
    and metric.provider_account_id = any(p_provider_account_ids)
    and metric.metric_date between p_since and p_until
    and metric.source = 'meta';

  insert into public.traffic_metrics_daily (
    organization_id,
    project_id,
    provider_account_id,
    metric_date,
    investment,
    impressions,
    clicks,
    page_views,
    checkouts,
    source,
    is_estimated,
    synced_at
  )
  select
    p_organization_id,
    p_project_id,
    row.provider_account_id,
    row.metric_date,
    row.investment,
    row.impressions,
    row.clicks,
    row.page_views,
    row.checkouts,
    'meta',
    false,
    now()
  from pg_catalog.jsonb_to_recordset(p_rows) as row(
    provider_account_id uuid,
    metric_date date,
    investment numeric,
    impressions bigint,
    clicks bigint,
    page_views bigint,
    checkouts bigint
  );
  get diagnostics v_processed = row_count;

  insert into public.sync_runs (
    organization_id,
    project_id,
    job_type,
    status,
    started_at,
    finished_at,
    records_processed,
    metadata
  )
  values (
    p_organization_id,
    p_project_id,
    'meta_insights',
    'succeeded',
    now(),
    now(),
    v_processed,
    pg_catalog.jsonb_build_object('since', p_since, 'until', p_until)
  );

  return v_processed;
end;
$$;

revoke all on function public.set_connection_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.get_connection_secret(uuid) from public, anon, authenticated;
revoke all on function public.delete_connection_secret(uuid) from public, anon, authenticated;
revoke all on function public.create_connection_with_secret(
  uuid, text, text, text, text, text, text
) from public, anon;
revoke all on function public.ingest_hotmart_sale(
  uuid, text, text, text, timestamptz, text, text, numeric, numeric, text, jsonb
) from public, anon, authenticated;
revoke all on function public.replace_meta_metrics(
  uuid, uuid, date, date, uuid[], jsonb
) from public, anon, authenticated;
grant execute on function public.set_connection_secret(uuid, text) to service_role;
grant execute on function public.get_connection_secret(uuid) to service_role;
grant execute on function public.delete_connection_secret(uuid) to service_role;
grant execute on function public.create_connection_with_secret(
  uuid, text, text, text, text, text, text
) to authenticated;
grant execute on function public.ingest_hotmart_sale(
  uuid, text, text, text, timestamptz, text, text, numeric, numeric, text, jsonb
) to service_role;
grant execute on function public.replace_meta_metrics(
  uuid, uuid, date, date, uuid[], jsonb
) to service_role;

revoke all privileges on table
  public.organizations,
  public.organization_members,
  public.experts,
  public.projects,
  public.integration_connections,
  public.integration_secrets,
  public.provider_accounts,
  public.project_accounts,
  public.products,
  public.funnel_stages,
  public.product_mappings,
  public.traffic_metrics_daily,
  public.sales_events,
  public.sales_event_items,
  public.project_costs,
  public.sync_runs,
  public.audit_events
from anon, authenticated;

revoke all privileges on sequence public.audit_events_id_seq from anon, authenticated;
revoke all privileges on table public.project_daily_metrics from anon, authenticated;

grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on
  public.organization_members,
  public.experts,
  public.projects,
  public.integration_connections,
  public.provider_accounts,
  public.project_accounts,
  public.products,
  public.funnel_stages,
  public.project_costs
to authenticated;
grant select on
  public.product_mappings,
  public.traffic_metrics_daily,
  public.sales_events,
  public.sales_event_items,
  public.sync_runs,
  public.audit_events
to authenticated;
grant select on public.project_daily_metrics to authenticated;

grant all privileges on table
  public.organizations,
  public.organization_members,
  public.experts,
  public.projects,
  public.integration_connections,
  public.integration_secrets,
  public.provider_accounts,
  public.project_accounts,
  public.products,
  public.funnel_stages,
  public.product_mappings,
  public.traffic_metrics_daily,
  public.sales_events,
  public.sales_event_items,
  public.project_costs,
  public.sync_runs,
  public.audit_events
to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;
grant select on public.project_daily_metrics to service_role;
