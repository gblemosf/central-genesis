begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(not has_function_privilege('anon','public.get_meta_sync_job_token()','execute'), 'anonymous cannot read job token');
select ok(not has_function_privilege('authenticated','public.claim_meta_sync_job()','execute'), 'users cannot claim cross-project jobs');
select ok(not has_function_privilege('authenticated','public.apply_meta_sync_job(uuid,date,date,uuid[],jsonb)','execute'), 'users cannot bypass project authorization');
select ok(has_function_privilege('service_role','public.apply_meta_sync_job(uuid,date,date,uuid[],jsonb)','execute'), 'worker can apply a lease');

insert into public.organizations(id,name) values('00000000-0000-0000-0000-000000000701','Meta Auto Test');
insert into public.projects(id,organization_id,name,slug,status) values
('00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-000000000701','Auto','meta-auto','active');
select is(public.claim_meta_sync_job(),null::jsonb,'unlinked projects are skipped');
insert into public.integration_connections(id,organization_id,name,provider) values
('00000000-0000-0000-0000-000000000703','00000000-0000-0000-0000-000000000701','Meta','meta');
insert into public.provider_accounts(id,organization_id,connection_id,external_id,name,account_type,currency,timezone) values
('00000000-0000-0000-0000-000000000704','00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000000703','act_test','Test','meta_ad_account','BRL','America/Sao_Paulo');
insert into public.project_accounts(organization_id,project_id,provider_account_id) values
('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-000000000704');
set local role service_role;
create temporary table meta_claim as select public.claim_meta_sync_job() as job;
select is((select job->>'projectId' from meta_claim),'00000000-0000-0000-0000-000000000702','worker claims linked project without a browser session');
select is((select job->>'initial' from meta_claim),'true','first sync includes history');
select is(public.claim_meta_sync_job(),null::jsonb,'overlapping worker cannot claim same project');
select throws_ok($$select public.apply_meta_sync_job('00000000-0000-0000-0000-000000000999','2026-09-01','2026-09-13',array['00000000-0000-0000-0000-000000000704'::uuid],'[]')$$,
  'P0001','invalid or expired Meta job','unknown job cannot modify traffic');
select is(public.apply_meta_sync_job((select (job->>'runId')::uuid from meta_claim),'2026-09-01','2026-09-13',
  array['00000000-0000-0000-0000-000000000704'::uuid],
  '[{"provider_account_id":"00000000-0000-0000-0000-000000000704","metric_date":"2026-09-01","investment":100,"impressions":1000,"clicks":100,"page_views":80,"checkouts":10}]'),1,'service commits authorized traffic and completes job atomically');
select is((select status::text from public.sync_runs where id=(select (job->>'runId')::uuid from meta_claim)),'succeeded','job is completed');
select is(public.claim_meta_sync_job(),null::jsonb,'successful project waits for next refresh');
reset role;
select * from finish();
rollback;
