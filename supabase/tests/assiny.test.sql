begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000091','00000000-0000-0000-0000-000000000000','authenticated','authenticated','assiny-admin@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000092','00000000-0000-0000-0000-000000000000','authenticated','authenticated','assiny-operator@example.invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000093','00000000-0000-0000-0000-000000000000','authenticated','authenticated','assiny-other@example.invalid','',now(),'{}','{}',now(),now());
select public.bootstrap_organization('00000000-0000-0000-0000-000000000091','Assiny Test');
insert into public.organizations (name) values ('Assiny Other');
insert into public.organization_members (organization_id,user_id,role)
select id,'00000000-0000-0000-0000-000000000093','owner' from public.organizations where name = 'Assiny Other';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000091';
select public.create_connection_with_secret((select id from public.organizations where name = 'Assiny Test'),'Assiny Preparation','assiny',
  jsonb_build_object('version',1,'provider','assiny','webhookToken',repeat('a',64))::text);
select public.create_project_with_defaults((select id from public.organizations where name = 'Assiny Test'),'Assiny Prepared Project','assiny-test','Test',null,'assiny',0,0,null,null);
select lives_ok($$select public.create_project_product(
  (select id from public.organizations where name = 'Assiny Test'),(select id from public.projects where slug = 'assiny-test'),
  (select id from public.integration_connections where name = 'Assiny Preparation'),'assiny-reference','Reference Product',0,'BRL',null)$$,
  'a prepared Assiny project permits a manual reference product');
select lives_ok($$select public.create_project_with_funnel(
  (select id from public.organizations where name = 'Assiny Test'),'Assiny Wizard Project','assiny-wizard-test','Test',null,'assiny',
  (select id from public.integration_connections where name = 'Assiny Preparation'),0,0,
  '[{"name":"Core","type":"core","color":null,"productId":null}]'::jsonb,null,null)$$,
  'wizard can prepare Assiny before provider validation');
reset role;
insert into public.organization_members (organization_id,user_id,role)
select id,'00000000-0000-0000-0000-000000000092','operator' from public.organizations where name = 'Assiny Test';

select is(public.resolve_assiny_webhook_connection((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('a',64)),
  (select id from public.integration_connections where name = 'Assiny Preparation'),'our token resolves its own Assiny connection');
select is(public.resolve_assiny_webhook_connection((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('b',64)),null::uuid,'wrong token is rejected');
select is(public.receive_assiny_webhook((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('a',64),repeat('1',64),'{"arbitrary":"uninterpreted"}') ->> 'state',
  'awaiting_contract','delivery remains uninterpreted');
select is(public.receive_assiny_webhook((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('a',64),repeat('1',64),'{"arbitrary":"uninterpreted"}') ->> 'duplicate','true','repeated delivery is acknowledged as duplicate');
select is((select count(*) from public.assiny_webhook_receipts where connection_id = (select id from public.integration_connections where name = 'Assiny Preparation')),1::bigint,'repeated delivery creates one receipt');
select is((select status::text from public.integration_connections where name = 'Assiny Preparation'),'attention','receipt never marks connection validated');
select is((select last_verified_at from public.integration_connections where name = 'Assiny Preparation'),null::timestamptz,'receipt never manufactures remote verification');
select is((select count(*) from public.sales_events where connection_id = (select id from public.integration_connections where name = 'Assiny Preparation')),0::bigint,'receipt creates no financial facts');
select is((select count(*) from public.checkout_recovery_attempts where connection_id = (select id from public.integration_connections where name = 'Assiny Preparation')),0::bigint,'receipt creates no recovery attempts');
select is((select count(*) from public.products where connection_id = (select id from public.integration_connections where name = 'Assiny Preparation')),1::bigint,'only manual reference product exists');
select ok(not has_table_privilege('authenticated','public.assiny_webhook_routes','SELECT'),'fingerprints are private');
select ok(not has_function_privilege('anon','public.resolve_assiny_webhook_connection(uuid,text)','EXECUTE'),'anonymous clients cannot resolve tokens');
select ok(not has_function_privilege('authenticated','public.receive_assiny_webhook(uuid,text,text,jsonb)','EXECUTE'),'ordinary clients cannot submit trusted deliveries');
select ok(not has_table_privilege('authenticated','public.assiny_webhook_receipts','INSERT'),'clients cannot forge receipts');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000092';
select is((select count(*) from public.assiny_webhook_receipts),0::bigint,'operators cannot inspect payloads');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000093';
select is((select count(*) from public.assiny_webhook_receipts),0::bigint,'admins of other organizations cannot inspect payloads');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000091';
select is((select count(*) from public.assiny_webhook_receipts),1::bigint,'own administrator can inspect receipt');
reset role;
select public.set_connection_secret((select id from public.integration_connections where name = 'Assiny Preparation'),
  jsonb_build_object('version',1,'provider','assiny','webhookToken',repeat('b',64))::text);
select is(public.resolve_assiny_webhook_connection((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('a',64)),null::uuid,'rotation rejects the old URL');
select is(public.resolve_assiny_webhook_connection((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('b',64)),
  (select id from public.integration_connections where name = 'Assiny Preparation'),'new URL works after rotation');
select throws_ok($$select public.receive_assiny_webhook((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('a',64),repeat('2',64),'{"arbitrary":"old token"}')$$,
  'P0001','active authenticated Assiny connection required','authentication is rechecked at persistence');
update public.integration_connections set revoked_at = now(),status = 'revoked' where name = 'Assiny Preparation';
select is(public.resolve_assiny_webhook_connection((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('b',64)),null::uuid,'revocation blocks the URL');
select throws_ok($$select public.receive_assiny_webhook((select id from public.integration_connections where name = 'Assiny Preparation'),repeat('b',64),repeat('2',64),'{"arbitrary":"revoked"}')$$,
  'P0001','active authenticated Assiny connection required','revoked connection cannot persist a receipt');
select * from finish();
rollback;
