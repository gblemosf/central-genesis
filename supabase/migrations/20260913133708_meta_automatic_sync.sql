-- Dedicated service-only scheduling. Existing provider credentials are untouched.
create index sync_runs_meta_auto_project_date_idx on public.sync_runs(project_id, created_at desc)
where job_type = 'meta_auto';
create unique index sync_runs_meta_auto_running_idx on public.sync_runs(project_id)
where job_type = 'meta_auto' and status = 'running';

create function public.get_meta_sync_job_token()
returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'genesis_meta_sync_job_token';
$$;
revoke all on function public.get_meta_sync_job_token() from public, anon, authenticated;
grant execute on function public.get_meta_sync_job_token() to service_role;

create function public.claim_meta_sync_job()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_project public.projects%rowtype; v_run uuid; v_initial boolean;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('genesis-meta-auto-claim', 0)) then return null; end if;
  update public.sync_runs r set status = 'failed', finished_at = now(), error_message = 'Sincronização interrompida; nova tentativa automática.'
  where r.job_type = 'meta_auto' and r.status = 'running' and r.started_at < now() - interval '10 minutes'
    and exists(select 1 from public.projects p where p.id = r.project_id and p.deleted_at is null);

  select p.* into v_project from public.projects p
  left join lateral (
    select r.created_at from public.sync_runs r where r.project_id = p.id and r.job_type = 'meta_auto'
    order by r.created_at desc limit 1
  ) latest on true
  where p.deleted_at is null and p.status = 'active'
    and (latest.created_at is null or latest.created_at < now() - interval '1 hour')
    and not exists(select 1 from public.sync_runs r where r.project_id = p.id and r.job_type = 'meta_auto' and r.status = 'running')
    and exists (
      select 1 from public.project_accounts l
      join public.provider_accounts a on a.id = l.provider_account_id and a.organization_id = p.organization_id
      join public.integration_connections c on c.id = a.connection_id and c.organization_id = p.organization_id
      where l.project_id = p.id and l.organization_id = p.organization_id
        and a.is_active and a.account_type = 'meta_ad_account' and a.currency = 'BRL'
        and a.timezone = p.reporting_timezone and c.provider = 'meta' and c.revoked_at is null
    )
  order by latest.created_at asc nulls first, p.id limit 1;
  if v_project.id is null then return null; end if;
  v_initial := not exists(select 1 from public.sync_runs r where r.project_id = v_project.id and r.job_type = 'meta_auto' and r.status = 'succeeded');
  insert into public.sync_runs(organization_id, project_id, job_type, status, started_at, metadata)
  values(v_project.organization_id, v_project.id, 'meta_auto', 'running', now(), jsonb_build_object('initial', v_initial)) returning id into v_run;
  return jsonb_build_object('runId', v_run, 'projectId', v_project.id, 'organizationId', v_project.organization_id,
    'timezone', v_project.reporting_timezone, 'initial', v_initial);
end;
$$;
revoke all on function public.claim_meta_sync_job() from public, anon, authenticated;
grant execute on function public.claim_meta_sync_job() to service_role;

-- The leased job supplies the project identity; the HTTP body cannot select a tenant.
create function public.apply_meta_sync_job(p_run_id uuid, p_since date, p_until date, p_provider_account_ids uuid[], p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_run public.sync_runs%rowtype; v_count integer;
begin
  select * into v_run from public.sync_runs where id = p_run_id and job_type = 'meta_auto'
    and status = 'running' and started_at > now() - interval '10 minutes' for update;
  if v_run.id is null then raise exception 'invalid or expired Meta job'; end if;
  perform 1 from public.projects where id = v_run.project_id and organization_id = v_run.organization_id
    and deleted_at is null and status = 'active' for update;
  if not found then raise exception 'project unavailable'; end if;
  if p_since is null or p_until is null or p_until < p_since or p_until - p_since > 365 then raise exception 'invalid Meta period'; end if;
  v_count := public.replace_meta_metrics_unchecked(v_run.organization_id, v_run.project_id, p_since, p_until, p_provider_account_ids, p_rows);
  update public.sync_runs set status = 'succeeded', finished_at = now(), records_processed = v_count,
    metadata = metadata || jsonb_build_object('since', p_since, 'until', p_until) where id = v_run.id;
  return v_count;
end;
$$;
revoke all on function public.apply_meta_sync_job(uuid, date, date, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.apply_meta_sync_job(uuid, date, date, uuid[], jsonb) to service_role;
