drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects
for all to authenticated
using (deleted_at is null and public.is_org_admin(organization_id))
with check (deleted_at is null and public.is_org_admin(organization_id));

create or replace function public.assert_active_project(
  p_organization_id uuid,
  p_project_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required' using errcode = '42501';
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
end;
$$;

revoke all on function public.assert_active_project(uuid, uuid)
from public, anon, authenticated, service_role;

create or replace function public.soft_delete_project(
  p_organization_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_at timestamptz := pg_catalog.clock_timestamp();
  v_name text;
  v_slug text;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required' using errcode = '42501';
  end if;

  select project.name, project.slug
  into v_name, v_slug
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and project.deleted_at is null
  for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  delete from public.project_accounts link
  where link.project_id = p_project_id
    and link.organization_id = p_organization_id;

  update public.product_mappings mapping
  set effective_to = greatest(
    v_deleted_at,
    mapping.effective_from + interval '1 microsecond'
  )
  where mapping.project_id = p_project_id
    and mapping.organization_id = p_organization_id
    and mapping.effective_to is null;

  update public.projects project
  set deleted_at = v_deleted_at,
      status = 'archived'
  where project.id = p_project_id
    and project.organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(), 'project.deleted', 'project', p_project_id::text,
    pg_catalog.jsonb_build_object('name', v_name, 'slug', v_slug)
  );

  return pg_catalog.jsonb_build_object(
    'id', p_project_id,
    'name', v_name,
    'deletedAt', v_deleted_at
  );
end;
$$;

revoke all on function public.soft_delete_project(uuid, uuid)
from public, anon;
grant execute on function public.soft_delete_project(uuid, uuid)
to authenticated;

create or replace function public.enforce_active_project_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_organization_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.project_id is not null then
    v_project_id := old.project_id;
    v_organization_id := old.organization_id;

    perform 1
    from public.projects project
    where project.id = v_project_id
      and project.organization_id = v_organization_id
      and project.deleted_at is null
    for key share;
    if not found then
      raise exception 'project is deleted or unavailable' using errcode = 'P0002';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  v_project_id := new.project_id;
  v_organization_id := new.organization_id;
  if v_project_id is null then
    return new;
  end if;

  perform 1
  from public.projects project
  where project.id = v_project_id
    and project.organization_id = v_organization_id
    and project.deleted_at is null
  for key share;
  if not found then
    raise exception 'project is deleted or unavailable' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_active_project_reference()
from public, anon, authenticated, service_role;

create trigger project_accounts_require_active_project
before insert or update or delete on public.project_accounts
for each row execute function public.enforce_active_project_reference();
create trigger funnel_stages_require_active_project
before insert or update or delete on public.funnel_stages
for each row execute function public.enforce_active_project_reference();
create trigger product_mappings_require_active_project
before insert or update or delete on public.product_mappings
for each row execute function public.enforce_active_project_reference();
create trigger traffic_metrics_require_active_project
before insert or update or delete on public.traffic_metrics_daily
for each row execute function public.enforce_active_project_reference();
create trigger sales_events_require_active_project
before insert or update or delete on public.sales_events
for each row execute function public.enforce_active_project_reference();
create trigger project_costs_require_active_project
before insert or update or delete on public.project_costs
for each row execute function public.enforce_active_project_reference();
create trigger sync_runs_require_active_project
before insert or update or delete on public.sync_runs
for each row execute function public.enforce_active_project_reference();
create trigger hubla_events_require_active_project
before insert or update or delete on public.hubla_webhook_events
for each row execute function public.enforce_active_project_reference();

create or replace function public.enforce_active_legacy_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    perform 1
    from public.projects project
    where project.organization_id = old.organization_id
      and project.slug = old.projeto
      and project.deleted_at is null
    for key share;

    if not found and exists (
      select 1
      from public.projects project
      where project.organization_id = old.organization_id
        and project.slug = old.projeto
        and project.deleted_at is not null
    ) then
      raise exception 'project is deleted or unavailable' using errcode = 'P0002';
    end if;
  end if;

  perform 1
  from public.projects project
  where project.organization_id = new.organization_id
    and project.slug = new.projeto
    and project.deleted_at is null
  for key share;

  if not found and exists (
    select 1
    from public.projects project
    where project.organization_id = new.organization_id
      and project.slug = new.projeto
      and project.deleted_at is not null
  ) then
    raise exception 'project is deleted or unavailable' using errcode = 'P0002';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_active_legacy_project()
from public, anon, authenticated, service_role;

create trigger legacy_traffic_require_active_project
before insert or update on public.metricas_trafego
for each row execute function public.enforce_active_legacy_project();
create trigger legacy_sales_require_active_project
before insert or update on public.metricas_vendas
for each row execute function public.enforce_active_legacy_project();
do $$
begin
  if pg_catalog.to_regclass('public.mapeamento_produtos') is not null then
    execute 'create trigger legacy_mappings_require_active_project
      before insert or update on public.mapeamento_produtos
      for each row execute function public.enforce_active_legacy_project()';
  end if;
end;
$$;

alter function public.create_project_funnel_stage(
  uuid, uuid, text, public.funnel_stage_type, text
) rename to create_project_funnel_stage_unchecked;
revoke all on function public.create_project_funnel_stage_unchecked(
  uuid, uuid, text, public.funnel_stage_type, text
) from public, anon, authenticated, service_role;
create function public.create_project_funnel_stage(
  p_organization_id uuid,
  p_project_id uuid,
  p_name text,
  p_stage_type public.funnel_stage_type,
  p_color text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  return public.create_project_funnel_stage_unchecked(
    p_organization_id, p_project_id, p_name, p_stage_type, p_color
  );
end;
$$;

alter function public.update_project_funnel_stage(
  uuid, uuid, uuid, text, public.funnel_stage_type, text, boolean
) rename to update_project_funnel_stage_unchecked;
revoke all on function public.update_project_funnel_stage_unchecked(
  uuid, uuid, uuid, text, public.funnel_stage_type, text, boolean
) from public, anon, authenticated, service_role;
create function public.update_project_funnel_stage(
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
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  perform public.update_project_funnel_stage_unchecked(
    p_organization_id, p_project_id, p_stage_id, p_name,
    p_stage_type, p_color, p_archived
  );
end;
$$;

alter function public.reorder_project_funnel_stages(
  uuid, uuid, uuid[]
) rename to reorder_project_funnel_stages_unchecked;
revoke all on function public.reorder_project_funnel_stages_unchecked(
  uuid, uuid, uuid[]
) from public, anon, authenticated, service_role;
create function public.reorder_project_funnel_stages(
  p_organization_id uuid,
  p_project_id uuid,
  p_stage_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  perform public.reorder_project_funnel_stages_unchecked(
    p_organization_id, p_project_id, p_stage_ids
  );
end;
$$;

alter function public.create_project_product(
  uuid, uuid, uuid, text, text, numeric, text, uuid
) rename to create_project_product_unchecked;
revoke all on function public.create_project_product_unchecked(
  uuid, uuid, uuid, text, text, numeric, text, uuid
) from public, anon, authenticated, service_role;
create function public.create_project_product(
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
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  return public.create_project_product_unchecked(
    p_organization_id, p_project_id, p_connection_id, p_external_id,
    p_name, p_current_price, p_currency, p_funnel_stage_id
  );
end;
$$;

alter function public.update_project_product(
  uuid, uuid, uuid, text, text, numeric, text, uuid
) rename to update_project_product_unchecked;
revoke all on function public.update_project_product_unchecked(
  uuid, uuid, uuid, text, text, numeric, text, uuid
) from public, anon, authenticated, service_role;
create function public.update_project_product(
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
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  perform public.update_project_product_unchecked(
    p_organization_id, p_project_id, p_product_id, p_external_id,
    p_name, p_current_price, p_currency, p_funnel_stage_id
  );
end;
$$;

alter function public.set_project_product_archived(
  uuid, uuid, uuid, boolean
) rename to set_project_product_archived_unchecked;
revoke all on function public.set_project_product_archived_unchecked(
  uuid, uuid, uuid, boolean
) from public, anon, authenticated, service_role;
create function public.set_project_product_archived(
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
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  perform public.set_project_product_archived_unchecked(
    p_organization_id, p_project_id, p_product_id, p_archived
  );
end;
$$;

alter function public.replace_project_product_mappings(
  uuid, uuid, jsonb
) rename to replace_project_product_mappings_unchecked;
revoke all on function public.replace_project_product_mappings_unchecked(
  uuid, uuid, jsonb
) from public, anon, authenticated, service_role;
create function public.replace_project_product_mappings(
  p_organization_id uuid,
  p_project_id uuid,
  p_mappings jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  perform public.replace_project_product_mappings_unchecked(
    p_organization_id, p_project_id, p_mappings
  );
end;
$$;

alter function public.set_project_meta_account(
  uuid, uuid, uuid
) rename to set_project_meta_account_unchecked;
revoke all on function public.set_project_meta_account_unchecked(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
create function public.set_project_meta_account(
  p_organization_id uuid,
  p_project_id uuid,
  p_provider_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  perform public.set_project_meta_account_unchecked(
    p_organization_id, p_project_id, p_provider_account_id
  );
end;
$$;

alter function public.replace_meta_metrics(
  uuid, uuid, date, date, uuid[], jsonb
) rename to replace_meta_metrics_unchecked;
revoke all on function public.replace_meta_metrics_unchecked(
  uuid, uuid, date, date, uuid[], jsonb
) from public, anon, authenticated, service_role;
create function public.replace_meta_metrics(
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
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  return public.replace_meta_metrics_unchecked(
    p_organization_id, p_project_id, p_since, p_until,
    p_provider_account_ids, p_rows
  );
end;
$$;

alter function public.import_project_csv_metrics(
  uuid, uuid, jsonb, jsonb, date, date
) rename to import_project_csv_metrics_unchecked;
revoke all on function public.import_project_csv_metrics_unchecked(
  uuid, uuid, jsonb, jsonb, date, date
) from public, anon, authenticated, service_role;
create function public.import_project_csv_metrics(
  p_organization_id uuid,
  p_project_id uuid,
  p_traffic jsonb,
  p_sales jsonb,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  return public.import_project_csv_metrics_unchecked(
    p_organization_id, p_project_id, p_traffic, p_sales,
    p_period_start, p_period_end
  );
end;
$$;

alter function public.ingest_hotmart_sale(
  uuid, text, text, text, timestamptz, text, text,
  numeric, numeric, text, jsonb
) rename to ingest_hotmart_sale_unchecked;
revoke all on function public.ingest_hotmart_sale_unchecked(
  uuid, text, text, text, timestamptz, text, text,
  numeric, numeric, text, jsonb
) from public, anon, authenticated, service_role;
create function public.ingest_hotmart_sale(
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
  v_event_id uuid;
  v_project_id uuid;
begin
  begin
    return query
    select *
    from public.ingest_hotmart_sale_unchecked(
      p_connection_id, p_external_event_id, p_external_transaction_id,
      p_event_type, p_event_at, p_product_external_id, p_product_name,
      p_gross_amount, p_net_amount, p_currency, p_payload
    );
    return;
  exception when sqlstate 'P0002' then
    select event.id, event.project_id
    into v_event_id, v_project_id
    from public.sales_events event
    join public.projects project on project.id = event.project_id
    where event.connection_id = p_connection_id
      and project.deleted_at is not null
      and (
        event.external_event_id = pg_catalog.btrim(p_external_event_id)
        or (
          event.external_transaction_id = pg_catalog.btrim(p_external_transaction_id)
          and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED')
        )
      )
    order by
      (event.external_event_id = pg_catalog.btrim(p_external_event_id)) desc
    limit 1;

    if v_event_id is null then
      raise;
    end if;

    return query select v_event_id, true, v_project_id is not null;
  end;
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
revoke all on function public.replace_project_product_mappings(
  uuid, uuid, jsonb
) from public, anon;
revoke all on function public.set_project_meta_account(
  uuid, uuid, uuid
) from public, anon;
revoke all on function public.replace_meta_metrics(
  uuid, uuid, date, date, uuid[], jsonb
) from public, anon;
revoke all on function public.import_project_csv_metrics(
  uuid, uuid, jsonb, jsonb, date, date
) from public, anon;
revoke all on function public.ingest_hotmart_sale(
  uuid, text, text, text, timestamptz, text, text,
  numeric, numeric, text, jsonb
) from public, anon, authenticated;

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
grant execute on function public.replace_project_product_mappings(
  uuid, uuid, jsonb
) to authenticated;
grant execute on function public.set_project_meta_account(
  uuid, uuid, uuid
) to authenticated;
grant execute on function public.replace_meta_metrics(
  uuid, uuid, date, date, uuid[], jsonb
) to authenticated;
grant execute on function public.import_project_csv_metrics(
  uuid, uuid, jsonb, jsonb, date, date
) to authenticated;
grant execute on function public.ingest_hotmart_sale(
  uuid, text, text, text, timestamptz, text, text,
  numeric, numeric, text, jsonb
) to service_role;
