-- Apply after deploying /api/jobs/meta. No existing provider token is changed.
do $$
begin
  if not exists(select 1 from vault.secrets where name = 'genesis_meta_sync_job_token') then
    perform vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'genesis_meta_sync_job_token');
  end if;
  perform cron.schedule('genesis-meta-sync', '*/5 * * * *', $job$
    select net.http_post(
      url := 'https://central-gestao-genesis.vercel.app/api/jobs/meta',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'genesis_meta_sync_job_token')),
      body := '{}'::jsonb, timeout_milliseconds := 180000
    );
  $job$);
end $$;
