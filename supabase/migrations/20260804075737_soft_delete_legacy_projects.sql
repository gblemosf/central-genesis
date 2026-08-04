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
  v_slug text := pg_catalog.btrim(coalesce(p_slug, ''));
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_project_id uuid;
  v_deleted_at timestamptz;
  v_legacy_exists boolean;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required' using errcode = '42501';
  end if;

  if v_slug = '' or pg_catalog.length(v_slug) > 200 then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if v_name = '' then
    v_name := pg_catalog.initcap(pg_catalog.replace(v_slug, '-', ' '));
  end if;
  if pg_catalog.length(v_name) > 120 then
    raise exception 'invalid project name' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.metricas_trafego metric
    where metric.organization_id = p_organization_id
      and metric.projeto = v_slug
  ) or exists (
    select 1 from public.metricas_vendas metric
    where metric.organization_id = p_organization_id
      and metric.projeto = v_slug
  ) into v_legacy_exists;

  if not v_legacy_exists
    and pg_catalog.to_regclass('public.mapeamento_produtos') is not null then
    execute 'select exists (
      select 1 from public.mapeamento_produtos mapping
      where mapping.organization_id = $1 and mapping.projeto = $2
    )'
    into v_legacy_exists
    using p_organization_id, v_slug;
  end if;

  if not v_legacy_exists then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  v_deleted_at := pg_catalog.clock_timestamp();
  insert into public.projects (
    organization_id, name, slug, status, deleted_at, settings
  )
  values (
    p_organization_id, v_name, v_slug, 'archived', v_deleted_at,
    pg_catalog.jsonb_build_object('legacy_tombstone', true)
  )
  on conflict (organization_id, slug) do nothing
  returning id into v_project_id;

  if v_project_id is null then
    select project.id
    into v_project_id
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
  )
  values (
    p_organization_id, auth.uid(), 'project.deleted', 'project', v_project_id::text,
    pg_catalog.jsonb_build_object(
      'name', v_name,
      'slug', v_slug,
      'legacy', true
    )
  );

  return pg_catalog.jsonb_build_object(
    'id', v_project_id,
    'name', v_name,
    'deletedAt', v_deleted_at
  );
end;
$$;

revoke all on function public.soft_delete_legacy_project(uuid, text, text)
from public, anon, service_role;
grant execute on function public.soft_delete_legacy_project(uuid, text, text)
to authenticated;
