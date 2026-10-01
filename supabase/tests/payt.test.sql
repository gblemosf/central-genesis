begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000081','00000000-0000-0000-0000-000000000000','authenticated','authenticated','payt-test@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000082','00000000-0000-0000-0000-000000000000','authenticated','authenticated','payt-operator@example.invalid','',now(),'{}','{}',now(),now());
select public.bootstrap_organization('00000000-0000-0000-0000-000000000081','Payt Test');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000081';
select public.create_connection_with_secret((select id from public.organizations where name = 'Payt Test'),'Payt Test Connection','payt',
  jsonb_build_object('version',1,'provider','payt','webhookToken',repeat('a',64))::text);
select public.create_project_with_defaults((select id from public.organizations where name = 'Payt Test'),'Payt Test Project','payt-test','Test',null,'payt',100,60,null,null);
select public.create_project_with_defaults((select id from public.organizations where name = 'Payt Test'),'Payt Other Project','payt-test-other','Test',null,'payt',100,60,null,null);
reset role;
insert into public.organization_members (organization_id,user_id,role)
select id,'00000000-0000-0000-0000-000000000082','operator' from public.organizations where name = 'Payt Test';

create function pg_temp.payt_event(p_status text,p_time timestamptz default '2026-09-15T12:00:00Z') returns jsonb language sql as $$
  select jsonb_build_object('status',p_status,'transaction_id','payt-synthetic-transaction','product_external_id','payt-synthetic-product','product_name','Synthetic Product',
  'occurred_at',p_time,'currency','BRL','financial',jsonb_build_object('gross',47,'platform_fee',5.18,'net_after_fees',41.82,'payout',19.66,'payout_source','payt_reported'),
  'contact',jsonb_build_object('name','Synthetic Buyer','email','payt-buyer@example.invalid','phone','5511999998888'),
  'attribution',jsonb_build_object('utm',jsonb_build_object('source','meta-ads','campaign','Synthetic Campaign'),'landing_url','https://example.invalid/page'),
  'offer','{}'::jsonb,'payment',jsonb_build_object('type','PIX'));
$$;

select is(public.resolve_payt_webhook_connection((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('a',64)),
  (select id from public.integration_connections where name = 'Payt Test Connection'),'delivery token resolves its own connection');
select is(public.resolve_payt_webhook_connection((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('b',64)),null::uuid,'wrong delivery token is rejected');
select is(public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('a',64),'{"status":"unknown"}') ->> 'state','awaiting_contract','unknown payload is durably buffered');
select is((select count(*) from public.sales_events where connection_id = (select id from public.integration_connections where name = 'Payt Test Connection')),0::bigint,'buffering never manufactures financial facts');
select is(public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('a',64),'{"status":"unknown"}',pg_temp.payt_event('pending')) ->> 'state','unmapped','configured event waits for its product mapping');
select is((select count(*) from public.products where external_id = 'payt-synthetic-product'),1::bigint,'normalized postback discovers a product');

insert into public.product_mappings (organization_id,project_id,product_id,funnel_stage_id,effective_from)
select project.organization_id,project.id,product.id,stage.id,'2026-09-01T00:00:00Z' from public.projects project
join public.funnel_stages stage on stage.project_id = project.id and stage.stage_type = 'core'
join public.products product on product.organization_id = project.organization_id and product.external_id = 'payt-synthetic-product'
where project.slug = 'payt-test';

select is(public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('a',64),'{"status":"unknown"}',pg_temp.payt_event('pending')) ->> 'state','processed','buffer can be processed after the product is linked');
select is((select status from public.checkout_recovery_attempts where external_id = 'payt-synthetic-transaction'),'pending','pending payment creates a recovery attempt');
select is(public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('b',64),'{"status":"paid"}',pg_temp.payt_event('paid','2026-09-15T12:02:00Z')) ->> 'state','processed','approval is processed');
select is((select status from public.checkout_recovery_attempts where external_id = 'payt-synthetic-transaction'),'recovered','approval recovers its pending transaction');
select is((select count(*) from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),1::bigint,'approval creates one sale');
select is((select payload #>> '{financial,net_after_fees}' from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),'41.82','net after fees is distinct from producer payout');
select is((select net_amount from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),19.66::numeric,'payout is stored separately');
select is((select count(*) from public.contacts where normalized_email = 'payt-buyer@example.invalid'),1::bigint,'pending and approval share one buyer');
select is((select count(*) from public.contact_touchpoints where external_id like 'payt-sale:%'),1::bigint,'approval creates one purchase touchpoint');
select is((select attributed_amount from public.sales_contact_attributions where sales_event_id = (select id from public.sales_events where external_transaction_id = 'payt-synthetic-transaction')),19.66::numeric,'buyer attribution uses the stored payout');
select is(public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('b',64),'{"status":"paid"}',pg_temp.payt_event('paid')) ->> 'duplicate','true','same delivery is deduplicated');
update public.product_mappings set effective_to = '2026-09-15T12:02:30Z' where product_id = (select id from public.products where external_id = 'payt-synthetic-product');
insert into public.product_mappings (organization_id,project_id,product_id,funnel_stage_id,effective_from)
select project.organization_id,project.id,product.id,stage.id,'2026-09-15T12:02:30Z' from public.projects project
join public.funnel_stages stage on stage.project_id = project.id and stage.stage_type = 'core'
join public.products product on product.organization_id = project.organization_id and product.external_id = 'payt-synthetic-product'
where project.slug = 'payt-test-other';
select public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('c',64),'{"status":"paid_later"}',
  jsonb_set(jsonb_set(pg_temp.payt_event('paid','2026-09-15T12:03:00Z'),'{financial}','{"gross":47,"platform_fee":null,"payout":null,"net_after_fees":null,"payout_source":"unknown"}'),'{attribution,utm}','{}'));
select is((select count(*) from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),1::bigint,'different deliveries cannot duplicate a transaction');
select is((select project_id from public.payt_webhook_receipts where idempotency_key = repeat('c',64)),(select id from public.projects where slug = 'payt-test'),'later approval keeps its original project after remapping');
select is((select payload #>> '{financial,platform_fee}' from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),'5.18','missing later fee preserves verified fee');
select is((select payload #>> '{financial,payout}' from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),'19.66','missing later payout preserves verified payout');
select is((select payload #>> '{attribution,utm,campaign}' from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),'Synthetic Campaign','empty later origin preserves campaign');
select is(public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('d',64),'{"status":"old"}',pg_temp.payt_event('paid','2026-09-15T11:00:00Z')) ->> 'state','processed','older approvals are safely processed');
select is((select event_at from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),'2026-09-15T12:03:00Z'::timestamptz,'late delivery cannot replace newer financial facts');
select is((select recovered_at from public.checkout_recovery_attempts where external_id = 'payt-synthetic-transaction'),'2026-09-15T12:03:00Z'::timestamptz,'older approvals cannot move recovery time backwards');
select public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('e',64),'{"status":"refunded"}',pg_temp.payt_event('refunded','2026-09-16T12:00:00Z'));
select is((select sum(gross_amount) from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),0::numeric,'refund reverses approved gross exactly once');
select is((select sum(net_amount) from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),0::numeric,'refund reverses payout exactly once');
select is((select count(distinct project_id) from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),1::bigint,'refund remains in the original purchase project after remapping');
select is((select sum(attributed_amount) from public.sales_contact_attributions where sales_event_id in (select id from public.sales_events where external_transaction_id = 'payt-synthetic-transaction')),0::numeric,'refund also reverses attributed revenue');
select is(public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('f',64),'{"status":"test"}',pg_temp.payt_event('paid') || '{"sandbox":true}') ->> 'state','test','sandbox tests stay out of financial totals');
select is((select count(*) from public.sales_events where external_transaction_id = 'payt-synthetic-transaction'),2::bigint,'sandbox adds no sale');
select public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('1',64),'{"status":"sale-first"}',jsonb_set(pg_temp.payt_event('paid','2026-09-15T12:04:00Z'),'{transaction_id}','"payt-synthetic-late-pending"'));
select is(public.receive_payt_postback((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('2',64),'{"status":"pending-later"}',jsonb_set(pg_temp.payt_event('pending','2026-09-15T12:05:00Z'),'{transaction_id}','"payt-synthetic-late-pending"')) ->> 'state','processed','pending delivery after approval is handled safely');
select is((select status from public.checkout_recovery_attempts where external_id = 'payt-synthetic-late-pending'),'recovered','late pending cannot reopen a paid transaction');
select ok(not has_function_privilege('authenticated','public.receive_payt_postback(uuid,text,jsonb,jsonb,text)','EXECUTE'),'ordinary clients cannot submit trusted financial events');
select ok(not has_function_privilege('authenticated','public.resolve_payt_webhook_connection(uuid,text)','EXECUTE'),'token resolution is private');
select ok(not has_table_privilege('authenticated','public.payt_webhook_routes','SELECT'),'delivery fingerprints are private');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000082';
select is((select count(*) from public.payt_webhook_receipts),0::bigint,'operators cannot read raw buyer payloads');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000081';
select ok((select count(*) from public.payt_webhook_receipts) > 0,'organization admin can inspect receipts');
reset role;
select public.set_connection_secret((select id from public.integration_connections where name = 'Payt Test Connection'),jsonb_build_object('version',1,'provider','payt','webhookToken',repeat('b',64))::text);
select is(public.resolve_payt_webhook_connection((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('a',64)),null::uuid,'rotation invalidates the old URL');
select is(public.resolve_payt_webhook_connection((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('b',64)),
  (select id from public.integration_connections where name = 'Payt Test Connection'),'rotation activates the new fingerprint');
update public.integration_connections set revoked_at = now(),status = 'revoked' where name = 'Payt Test Connection';
select is(public.resolve_payt_webhook_connection((select id from public.integration_connections where name = 'Payt Test Connection'),repeat('b',64)),null::uuid,'revocation stops delivery');
select * from finish();
rollback;
