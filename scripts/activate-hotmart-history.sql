-- Run after the application deployment. Only this import job's configuration is changed.
do $$
declare v_job bigint;
begin
  if not exists(select 1 from vault.secrets where name='genesis_hotmart_history_job_token') then
    perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'genesis_hotmart_history_job_token');
  end if;
  select jobid into v_job from cron.job where jobname='genesis-hotmart-history';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('genesis-hotmart-history','* * * * *', $job$
    select net.http_post(
      url := 'https://central-gestao-genesis.vercel.app/api/jobs/hotmart-history',
      headers := jsonb_build_object('Content-Type','application/json','Authorization',
        'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='genesis_hotmart_history_job_token')),
      body := '{}'::jsonb, timeout_milliseconds := 180000
    );
  $job$);
end $$;
