create function public.extract_hubla_webhook_token(p_secret text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_token text;
begin
  begin
    v_payload := p_secret::jsonb;
  exception when others then
    return nullif(pg_catalog.btrim(p_secret), '');
  end;

  if pg_catalog.jsonb_typeof(v_payload) = 'object'
    and v_payload ->> 'version' = '1'
    and v_payload ->> 'provider' = 'hubla' then
    v_token := nullif(pg_catalog.btrim(v_payload ->> 'webhookToken'), '');
  end if;

  return v_token;
end;
$$;

revoke all on function public.extract_hubla_webhook_token(text)
from public, anon, authenticated;

create table public.hubla_webhook_routes (
  connection_id uuid primary key
    references public.integration_secrets(connection_id) on delete cascade,
  token_fingerprint bytea not null unique,
  rotated_at timestamptz not null default now(),
  check (pg_catalog.octet_length(token_fingerprint) = 32)
);

alter table public.hubla_webhook_routes enable row level security;

revoke all on table public.hubla_webhook_routes
from public, anon, authenticated;
grant all on table public.hubla_webhook_routes to service_role;

insert into public.hubla_webhook_routes (
  connection_id,
  token_fingerprint,
  rotated_at
)
select
  connection.id,
  extensions.digest(token.value, 'sha256'),
  secret.rotated_at
from public.integration_connections connection
join public.integration_secrets secret
  on secret.connection_id = connection.id
join vault.decrypted_secrets decrypted
  on decrypted.id = secret.vault_secret_id
cross join lateral (
  select public.extract_hubla_webhook_token(decrypted.decrypted_secret) as value
) token
where connection.provider = 'hubla'
  and connection.revoked_at is null
  and pg_catalog.length(token.value) between 8 and 1024
on conflict do nothing;

create or replace function public.set_connection_secret(
  p_connection_id uuid,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
  new_secret_id uuid;
  v_provider public.integration_provider;
  v_hubla_token text;
begin
  if pg_catalog.length(p_secret) not between 8 and 16384 then
    raise exception 'invalid credential';
  end if;

  select connection.provider
  into v_provider
  from public.integration_connections connection
  where connection.id = p_connection_id
  for update;
  if v_provider is null then
    raise exception 'connection not found';
  end if;

  if v_provider = 'hubla' then
    v_hubla_token := public.extract_hubla_webhook_token(p_secret);
    if pg_catalog.length(v_hubla_token) not between 8 and 1024 then
      raise exception 'invalid Hubla webhook token';
    end if;
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

  if v_provider = 'hubla' then
    insert into public.hubla_webhook_routes (
      connection_id,
      token_fingerprint,
      rotated_at
    ) values (
      p_connection_id,
      extensions.digest(v_hubla_token, 'sha256'),
      now()
    )
    on conflict (connection_id) do update
    set token_fingerprint = excluded.token_fingerprint,
        rotated_at = excluded.rotated_at;
  else
    delete from public.hubla_webhook_routes
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

revoke all on function public.set_connection_secret(uuid, text)
from public, anon, authenticated;
grant execute on function public.set_connection_secret(uuid, text)
to service_role;

create function public.resolve_hubla_webhook_connection(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select route.connection_id
  from public.hubla_webhook_routes route
  join public.integration_connections connection
    on connection.id = route.connection_id
  where pg_catalog.length(p_token) between 8 and 1024
    and route.token_fingerprint = extensions.digest(p_token, 'sha256')
    and connection.provider = 'hubla'
    and connection.revoked_at is null
  limit 1;
$$;

revoke all on function public.resolve_hubla_webhook_connection(text)
from public, anon, authenticated;
grant execute on function public.resolve_hubla_webhook_connection(text)
to service_role;
