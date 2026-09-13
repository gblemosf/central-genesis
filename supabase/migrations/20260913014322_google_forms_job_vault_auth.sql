-- Only the server can read this dedicated token. No other Vault secret is exposed.
create function public.get_google_forms_sync_token()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'genesis_google_forms_job_token';
$$;
revoke all on function public.get_google_forms_sync_token() from public, anon, authenticated, service_role;
grant execute on function public.get_google_forms_sync_token() to service_role;
