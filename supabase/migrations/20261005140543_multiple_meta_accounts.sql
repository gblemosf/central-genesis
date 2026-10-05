-- Replace the selected links atomically. Existing traffic remains attached to its
-- original account; changing the primary account never erases historical metrics.
create or replace function public.set_project_meta_accounts(
  p_organization_id uuid,
  p_project_id uuid,
  p_provider_account_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_provider_account_ids, '{}'::uuid[]);
  v_count integer := cardinality(v_ids);
begin
  if auth.uid() is null then
    raise exception 'admin permission required' using errcode = '42501';
  end if;
  perform public.assert_active_project(p_organization_id, p_project_id);

  if v_count > 50 or (v_count > 0 and (array_ndims(v_ids) <> 1 or array_lower(v_ids, 1) <> 1))
    or exists (select 1 from unnest(v_ids) id where id is null)
    or (select count(distinct id) from unnest(v_ids) id) <> v_count then
    raise exception 'invalid account selection' using errcode = '22023';
  end if;

  -- Stable locks serialize two projects attempting to claim the same account.
  perform account.id from public.provider_accounts account
  where account.id = any(v_ids)
  order by account.id for update;

  if (select count(*)
      from public.provider_accounts account
      join public.integration_connections connection on connection.id = account.connection_id
      join public.projects project on project.id = p_project_id
      where account.id = any(v_ids)
        and account.organization_id = p_organization_id
        and connection.organization_id = p_organization_id
        and account.account_type = 'meta_ad_account'
        and account.is_active
        and account.currency = project.currency
        and account.timezone = project.reporting_timezone
        and connection.provider = 'meta'
        and connection.revoked_at is null) <> v_count then
    raise exception 'active Meta accounts with matching currency and timezone required'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.project_accounts link
    where link.provider_account_id = any(v_ids) and link.project_id <> p_project_id
  ) then
    raise exception 'account already linked to another project' using errcode = '23505';
  end if;

  update public.project_accounts link set is_primary = false
  where link.project_id = p_project_id and link.organization_id = p_organization_id;

  delete from public.project_accounts link
  where link.project_id = p_project_id and link.organization_id = p_organization_id
    and not (link.provider_account_id = any(v_ids));

  insert into public.project_accounts (organization_id, project_id, provider_account_id, is_primary)
  select p_organization_id, p_project_id, id, position = 1
  from unnest(v_ids) with ordinality selected(id, position)
  on conflict (project_id, provider_account_id) do update
  set is_primary = excluded.is_primary;
end;
$$;

revoke all on function public.set_project_meta_accounts(uuid, uuid, uuid[]) from public, anon, service_role;
grant execute on function public.set_project_meta_accounts(uuid, uuid, uuid[]) to authenticated;
