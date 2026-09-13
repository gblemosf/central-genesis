begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operations-test@example.invalid', '', now(), '{}', '{}', now(), now());
select public.bootstrap_organization('00000000-0000-0000-0000-000000000091', 'Operations Test');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000091';
select public.create_project_with_defaults((select id from public.organizations where name = 'Operations Test'), 'Operations Test', 'operations-test', 'Test', null, 'hotmart', 100, 60, null, null);
select public.create_connection_with_secret((select id from public.organizations where name = 'Operations Test'), 'Operations Hotmart', 'hotmart', 'test-only-token', null, null, null);
select public.create_connection_with_secret((select id from public.organizations where name = 'Operations Test'), 'Operations Google', 'google_forms', 'test-only-token', null, null, null);
reset role;
insert into public.products (organization_id, connection_id, external_id, name, current_price, currency, source)
select organization_id, id, 'operations-product', 'Operations Product', 47, 'BRL', 'provider' from public.integration_connections where name = 'Operations Hotmart';
insert into public.product_mappings (organization_id, project_id, product_id, funnel_stage_id, effective_from)
select p.organization_id, p.id, product.id, stage.id, '2026-09-01T00:00:00Z'
from public.projects p join public.funnel_stages stage on stage.project_id = p.id and stage.stage_type = 'core'
join public.products product on product.organization_id = p.organization_id where p.slug = 'operations-test';

select lives_ok($$select * from public.ingest_hotmart_sale(
  (select id from public.integration_connections where name = 'Operations Hotmart'), 'operations-approved', 'operations-transaction', 'PURCHASE_APPROVED', '2026-09-02T12:00:00Z',
  'operations-product', 'Operations Product', 47, 19.66, 'BRL',
  '{"contact":{"name":"Example","email":"buyer@example.invalid","phone":"5511999998888"},"attribution":{"utm":{"source":"meta-ads","campaign":"Campaign | Preserved"},"landing_url":"https://example.invalid/page"},"financial":{"platform_fee":5.18,"payout":19.66,"payout_source":"producer_commission"}}'::jsonb)$$,
  'approved purchase creates scoped contact and attribution');
select is((select count(*) from public.contacts where normalized_email='buyer@example.invalid'), 1::bigint, 'one buyer is stored');
select is((select count(*) from public.contact_touchpoints where touchpoint_type='purchase'), 1::bigint, 'one purchase touchpoint is stored');
select lives_ok($$select * from public.ingest_hotmart_sale(
  (select id from public.integration_connections where name = 'Operations Hotmart'), 'operations-completed', 'operations-transaction', 'PURCHASE_COMPLETED', '2026-09-02T12:00:00Z',
  'operations-product', 'Operations Product', 47, 47, 'BRL', '{"attribution":{"utm":{"source":"","campaign":""}},"financial":{"platform_fee":null,"payout":null}}'::jsonb)$$,
  'completion without attribution keeps the approval information');
select is((select count(*) from public.sales_events where external_transaction_id='operations-transaction'), 1::bigint, 'approval and completion are one purchase');
select is((select payload #>> '{attribution,utm,campaign}' from public.sales_events where external_transaction_id='operations-transaction'), 'Campaign | Preserved', 'empty UTMs do not erase the campaign');
select is((select payload #>> '{financial,platform_fee}' from public.sales_events where external_transaction_id='operations-transaction'), '5.18', 'unknown fee does not erase the known fee');
select is((select count(*) from public.contact_touchpoints where touchpoint_type='purchase'), 1::bigint, 'completion does not duplicate touchpoints');
select is((select count(*) from public.sales_contact_attributions), 1::bigint, 'completion does not duplicate attribution');
select is((select net_amount from public.sales_event_items where sales_event_id = (select id from public.sales_events where external_transaction_id='operations-transaction')), 19.66::numeric, 'completion preserves the producer payout in metric items');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000091';
select public.attach_google_form((select id from public.organizations where name = 'Operations Test'), (select id from public.projects where slug='operations-test'),
  (select id from public.integration_connections where name='Operations Google'), 'operations-form', 'Example Form', null, null, null, '{}');
reset role;
select public.sync_google_form_schema((select id from public.google_forms where external_form_id='operations-form'), 'Example Form', null, 'v1', 'hash1',
  '[{"questionId":"q1","title":"Original title","type":"text","position":0},{"questionId":"q2","title":"Original title","type":"choice","position":1}]');
select lives_ok($$select public.ingest_google_form_response((select id from public.google_forms where external_form_id='operations-form'),
  '{"externalResponseId":"response1","createdAt":"2026-09-02T10:00:00Z","submittedAt":"2026-09-02T10:00:00Z","identity":{"email":"buyer@example.invalid"},"answers":[{"questionId":"q1","values":["First answer"]},{"questionId":"q2","values":["A","B"]},{"questionId":"deleted-before-import","values":["Historical answer"]}]}')$$,
  'form import keeps all answer IDs including an unknown removed question');
select is((select count(*) from public.google_form_answers), 3::bigint, 'all three answers are saved');
select is((select count(*) from public.contacts where normalized_email='buyer@example.invalid'), 1::bigint, 'form response and purchase share the same contact');
select is((select count(distinct google_form_question_id) from public.google_form_answers), 3::bigint, 'repeated titles remain distinct columns');
select public.sync_google_form_schema((select id from public.google_forms where external_form_id='operations-form'), 'Example Form', null, 'v2', 'hash2',
  '[{"questionId":"q1","title":"Renamed title","type":"text","position":0},{"questionId":"q3","title":"New question","type":"text","position":1}]');
select public.ingest_google_form_response((select id from public.google_forms where external_form_id='operations-form'),
  '{"externalResponseId":"response1","createdAt":"2026-09-02T10:00:00Z","submittedAt":"2026-09-02T10:00:00Z","identity":{"email":"buyer@example.invalid"},"answers":[{"questionId":"q1","values":["First answer"]}]}');
select is((select a.question_title_snapshot from public.google_form_answers a join public.google_form_questions q on q.id=a.google_form_question_id where q.external_question_id='q1'), 'Original title', 'replaying the same response preserves the question snapshot');
select is((select count(*) from public.google_form_answers), 3::bigint, 'a replay after schema changes does not erase historical answers');
select is((select count(*) from public.google_form_questions where archived_at is not null), 2::bigint, 'removed questions remain archived and available');
select is((select count(*) from public.google_form_questions where archived_at is null), 2::bigint, 'new question appears without manual column configuration');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000092';
select is((select count(*) from public.google_form_answers), 0::bigint, 'another user cannot read form answers');
select is((select count(*) from public.contacts), 0::bigint, 'another user cannot read contacts');
select is((select count(*) from public.sales_events), 0::bigint, 'another user cannot read sales');
reset role;
select ok(not has_function_privilege('anon', 'public.enrich_hotmart_sale_contact()', 'EXECUTE'), 'contact enrichment cannot be invoked anonymously');
select ok(not has_function_privilege('authenticated', 'public.ingest_google_form_response(uuid,jsonb)', 'EXECUTE'), 'response ingestion remains service-only');
select * from finish();
rollback;
