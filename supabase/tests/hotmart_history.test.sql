begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000000','authenticated','authenticated','history@example.invalid','',now(),'{}','{}',now(),now());
select public.bootstrap_organization('00000000-0000-0000-0000-000000000201','History Test');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000201';
select public.create_project_with_defaults((select id from public.organizations where name='History Test'),'History Test','history-test','Test',null,'hotmart',100,60,null,null);
select public.create_connection_with_secret((select id from public.organizations where name='History Test'),'History Hotmart','hotmart','test-only-token',null,null,null);
reset role;
insert into public.products(organization_id,connection_id,external_id,name,current_price,currency,source)
select organization_id,id,'history-product','History Product',47,'BRL','provider' from public.integration_connections where name='History Hotmart';
insert into public.product_mappings(organization_id,project_id,product_id,funnel_stage_id,effective_from)
select p.organization_id,p.id,product.id,stage.id,'2026-09-10T00:00:00Z' from public.projects p
join public.funnel_stages stage on stage.project_id=p.id and stage.stage_type='core'
join public.products product on product.organization_id=p.organization_id where p.slug='history-test';
select public.start_hotmart_history_import((select id from public.organizations where name='History Test'),
  (select id from public.projects where slug='history-test'),(select id from public.products where external_id='history-product'),
  '00000000-0000-0000-0000-000000000201','2026-09-01','2026-09-10');
select is((select effective_from from public.product_mappings where product_id=(select id from public.products where external_id='history-product')),
  '2026-09-01T03:00:00Z'::timestamptz,'explicit import extends mapping to selected Sao Paulo start');
select public.start_hotmart_history_import((select id from public.organizations where name='History Test'),
  (select id from public.projects where slug='history-test'),(select id from public.products where external_id='history-product'),
  '00000000-0000-0000-0000-000000000201','2026-09-01','2026-09-10');
select is((select count(*) from public.hotmart_import_jobs),1::bigint,'double submission has one active import');
select count(*) from public.claim_hotmart_history_import();
select is((select count(*) from public.claim_hotmart_history_import()),0::bigint,'a second worker cannot claim the leased job');

create function pg_temp.history_rows(p_status text,p_transaction text default 'history-transaction') returns jsonb language sql as $$
select jsonb_build_array(jsonb_build_object('status',p_status,'orderedAt','2026-09-01T12:00:00Z',
  'approvedAt',case when p_status in ('APPROVED','COMPLETE') then '2026-09-03T12:00:00Z' end,
  'sale',jsonb_build_object('externalTransactionId',p_transaction,'eventType',case when p_status='COMPLETE' then 'PURCHASE_COMPLETED' else 'PURCHASE_APPROVED' end,
    'eventAt','2026-09-03T12:00:00Z','productExternalId','history-product','productName','History Product','grossAmount',47,'netAmount',20,'currency','BRL',
    'payload','{"import_source":"hotmart_api","product_external_id":"history-product","product_name":"History Product","financial":{"gross":47,"platform_fee":5,"payout":20,"payout_source":"producer_commission"},"contact":{"name":"Test buyer","email":"buyer@example.invalid"},"attribution":{"utm":{"source":"instagram","campaign":"history-test"}}}'::jsonb)))
$$;
select throws_ok($$select public.apply_hotmart_history_page(id,gen_random_uuid(),pg_temp.history_rows('APPROVED'),null,now()) from public.hotmart_import_jobs$$,
  'P0001','Importação em processamento por outra execução.','stale lease cannot write or advance checkpoint');
select throws_ok($$select public.apply_hotmart_history_page(id,lease_id,jsonb_set(pg_temp.history_rows('APPROVED'),'{0,sale,productExternalId}','"another-product"'),null,now()) from public.hotmart_import_jobs$$,
  'P0001','A Hotmart retornou um produto ou período diferente do solicitado.','wrong product rolls back the entire page');
select is((select processed from public.hotmart_import_jobs),0,'failed page has no checkpoint advance');
select public.apply_hotmart_history_page(id,lease_id,pg_temp.history_rows('WAITING_PAYMENT'),'{"statusIndex":0,"windowStart":1788231600000}','2026-09-02T12:00:00Z') from public.hotmart_import_jobs;
select is((select count(*) from public.sales_events where external_transaction_id='history-transaction'),0::bigint,'pending purchase is not revenue');
select is((select status from public.checkout_recovery_attempts where external_id='history-transaction'),'pending','pending purchase is available for recovery');
select count(*) from public.claim_hotmart_history_import();
select public.apply_hotmart_history_page(id,lease_id,pg_temp.history_rows('APPROVED'),'{"statusIndex":1,"windowStart":1788231600000}','2026-09-04T12:00:00Z') from public.hotmart_import_jobs;
select is((select count(*) from public.sales_events where external_transaction_id='history-transaction'),1::bigint,'approval creates one mapped purchase');
select ok((select project_id is not null from public.sales_events where external_transaction_id='history-transaction'),'historical sale maps to selected project');
select is((select status from public.checkout_recovery_attempts where external_id='history-transaction'),'recovered','observed pending state followed by approval proves recovery');
select is((select count(*) from public.contacts where normalized_email='buyer@example.invalid'),1::bigint,'buyer is materialized for forms and contact conversion');
select count(*) from public.claim_hotmart_history_import();
select public.apply_hotmart_history_page(id,lease_id,pg_temp.history_rows('COMPLETE'),'{"statusIndex":2,"windowStart":1788231600000}','2026-09-05T12:00:00Z') from public.hotmart_import_jobs;
select count(*) from public.claim_hotmart_history_import();
select public.apply_hotmart_history_page(id,lease_id,pg_temp.history_rows('APPROVED'),'{"statusIndex":3,"windowStart":1788231600000}','2026-09-06T12:00:00Z') from public.hotmart_import_jobs;
select is((select count(*) from public.sales_events where external_transaction_id='history-transaction'),1::bigint,'API replay and completion never duplicate a purchase');
select is((select event_type::text from public.sales_events where external_transaction_id='history-transaction'),'PURCHASE_COMPLETED','a replay cannot regress completed sale');
select is((select count(*) from public.contact_touchpoints where touchpoint_type='purchase'),1::bigint,'attribution is idempotent');
select count(*) from public.claim_hotmart_history_import();
select public.apply_hotmart_history_page(id,lease_id,pg_temp.history_rows('PARTIALLY_REFUNDED'),null,'2026-09-07T12:00:00Z') from public.hotmart_import_jobs;
select is((select purchase_status from public.hotmart_history_records where transaction_id='history-transaction'),'PARTIALLY_REFUNDED','partial refund current state is retained');
select is((select count(*) from public.recognized_sales_events where external_transaction_id='history-transaction'),0::bigint,'unreconciled partial refund is excluded from recognized metrics');
select is((select coalesce(sum(revenue),0) from public.project_daily_metrics where project_id=(select id from public.projects where slug='history-test')),0::numeric,'overview does not overstate unsettled historical revenue');
select is((select count(*) from public.sales_events where event_type='PURCHASE_REFUNDED'),0::bigint,'API status does not fabricate a refund amount or date');
select is((select status from public.hotmart_import_jobs),'completed','last page completes the durable job');

set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000202';
select is((select count(*) from public.hotmart_import_jobs),0::bigint,'other users cannot read import jobs');
select is((select count(*) from public.hotmart_history_records),0::bigint,'other users cannot read sales history');
reset role;
select ok(not has_function_privilege('authenticated','public.start_hotmart_history_import(uuid,uuid,uuid,uuid,date,date)','EXECUTE'),'browser cannot bypass route authorization');
select ok(not has_function_privilege('anon','public.claim_hotmart_history_import()','EXECUTE'),'anonymous callers cannot claim jobs');
select ok(not has_function_privilege('authenticated','public.get_hotmart_history_job_token()','EXECUTE'),'job secret is not exposed to browser sessions');
select * from finish();
rollback;
