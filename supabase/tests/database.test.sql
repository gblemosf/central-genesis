begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'owner@example.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'other@example.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

select lives_ok(
  $$select public.bootstrap_organization(
    '00000000-0000-0000-0000-000000000001', 'Genesis'
  )$$,
  'bootstrap creates the first organization'
);
select is((select count(*) from public.organizations), 1::bigint, 'one organization exists');
select is(
  (select role::text from public.organization_members where user_id = '00000000-0000-0000-0000-000000000001'),
  'owner',
  'bootstrap user is owner'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is((select count(*) from public.organizations), 1::bigint, 'owner can read own organization');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is((select count(*) from public.organizations), 0::bigint, 'unassigned user cannot read organizations');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.create_project_with_defaults(
    (select id from public.organizations where name = 'Genesis'),
    'Projeto Teste', 'projeto-teste', 'Expert Teste', null,
    'hotmart', 100000, 60, null, null
  )$$,
  'owner creates project and funnel atomically'
);
select lives_ok(
  $$select public.create_connection_with_secret(
    (select id from public.organizations where name = 'Genesis'),
    'Hotmart Principal', 'hotmart', 'super-secret-hottok', null, null, null
  )$$,
  'owner creates connection and secret atomically'
);
select lives_ok(
  $$select public.create_connection_with_secret(
    (select id from public.organizations where name = 'Genesis'),
    'Meta Principal', 'meta', 'meta-system-user-token', null, null, null
  )$$,
  'owner creates Meta connection and secret atomically'
);
insert into public.provider_accounts (
  organization_id, connection_id, external_id, name, account_type, currency, timezone, is_active
)
select organization.id, connection.id, 'act_123', 'Conta Meta Teste', 'meta_ad_account', 'BRL', 'America/Sao_Paulo', true
from public.organizations organization
join public.integration_connections connection
  on connection.organization_id = organization.id
where organization.name = 'Genesis' and connection.name = 'Meta Principal';
select lives_ok(
  $$select public.set_project_meta_account(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.provider_accounts where external_id = 'act_123')
  )$$,
  'owner links an active Meta account to the project'
);

reset role;
select is(
  public.get_connection_secret((select id from public.integration_connections where name = 'Hotmart Principal')),
  'super-secret-hottok',
  'credential is readable through the service-only wrapper'
);
select lives_ok(
  $$select public.replace_meta_metrics(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    '2026-07-01', '2026-07-31',
    array[(select id from public.provider_accounts where external_id = 'act_123')]::uuid[],
    jsonb_build_array(jsonb_build_object(
      'provider_account_id', (select id from public.provider_accounts where external_id = 'act_123'),
      'metric_date', '2026-07-27',
      'investment', 25,
      'impressions', 1000,
      'clicks', 50,
      'page_views', 20,
      'checkouts', 5
    ))
  )$$,
  'Meta range is replaced atomically'
);
select is((select count(*) from public.traffic_metrics_daily), 1::bigint, 'Meta metric is persisted');
select is(
  (select status::text from public.sync_runs where job_type = 'meta_insights'),
  'succeeded',
  'Meta sync run is recorded'
);
select lives_ok(
  $$select * from public.ingest_hotmart_sale(
    (select id from public.integration_connections where name = 'Hotmart Principal'),
    'evt-1', 'txn-1', 'PURCHASE_APPROVED', '2026-07-27T12:00:00Z',
    'product-1', 'Produto Teste', 100, 90, 'BRL',
    '{"product_external_id":"product-1"}'::jsonb
  )$$,
  'Hotmart event is ingested atomically'
);
select ok(
  (select project_id is null and processed_at is null from public.sales_events where external_event_id = 'evt-1'),
  'unmapped event is quarantined'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.replace_project_product_mappings(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where external_id = 'product-1'),
      'funnel_stage_id', (
        select id from public.funnel_stages
        where project_id = (select id from public.projects where slug = 'projeto-teste')
          and stage_type = 'core'
      )
    ))
  )$$,
  'mapping reprocesses quarantined events'
);

reset role;
select ok(
  (select project_id is not null and processed_at is not null from public.sales_events where external_event_id = 'evt-1'),
  'mapped event leaves quarantine'
);
select is((select count(*) from public.sales_event_items), 1::bigint, 'mapped event has one item');
select is(
  (select revenue from public.project_daily_metrics where metric_date = '2026-07-27'),
  90::numeric,
  'daily metrics expose net revenue'
);
select is(
  (select core_sales from public.project_daily_metrics where metric_date = '2026-07-27'),
  1::numeric,
  'daily metrics count core items'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.replace_project_product_mappings(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    '[]'::jsonb
  )$$,
  'product can be unmapped while preserving history'
);
select lives_ok(
  $$select public.replace_project_product_mappings(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where external_id = 'product-1'),
      'funnel_stage_id', (
        select id from public.funnel_stages
        where project_id = (select id from public.projects where slug = 'projeto-teste')
          and stage_type = 'core'
      )
    ))
  )$$,
  'product can be remapped without resetting history to epoch'
);
reset role;
select is(
  (
    select count(*)
    from public.product_mappings newer
    join public.product_mappings older
      on older.product_id = newer.product_id and older.id < newer.id
    where tstzrange(older.effective_from, older.effective_to, '[)')
      && tstzrange(newer.effective_from, newer.effective_to, '[)')
  ),
  0::bigint,
  'product mapping periods never overlap'
);
select ok(
  (select duplicate from public.ingest_hotmart_sale(
    (select id from public.integration_connections where name = 'Hotmart Principal'),
    'evt-1-retry', 'txn-1', 'PURCHASE_COMPLETED', '2026-07-27T12:00:00Z',
    'product-1', 'Produto Teste', 110, 95, 'BRL',
    '{"product_external_id":"product-1"}'::jsonb
  )),
  'transaction retry is reported as duplicate'
);
select is(
  (select net_amount from public.sales_events where external_transaction_id = 'txn-1'),
  95::numeric,
  'completed event refreshes the canonical financial values'
);
select ok(
  (select duplicate from public.ingest_hotmart_sale(
    (select id from public.integration_connections where name = 'Hotmart Principal'),
    'evt-1-late-approved', 'txn-1', 'PURCHASE_APPROVED', '2026-07-27T12:00:00Z',
    'product-1', 'Produto Teste Antigo', 50, 40, 'BRL',
    '{"product_external_id":"product-1"}'::jsonb
  )),
  'late approved retry is reported as duplicate'
);
select is(
  (select net_amount from public.sales_events where external_transaction_id = 'txn-1'),
  95::numeric,
  'late approved retry cannot regress completed financial values'
);
select is((select count(*) from public.sales_events), 1::bigint, 'duplicate does not create another event');
select lives_ok(
  $$select public.replace_meta_metrics(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    '2026-07-01', '2026-07-31',
    array[(select id from public.provider_accounts where external_id = 'act_123')]::uuid[],
    '[]'::jsonb
  )$$,
  'empty Meta response atomically clears stale range'
);
select is((select count(*) from public.traffic_metrics_daily), 0::bigint, 'stale Meta metrics are removed');

insert into public.organizations (name) values ('Other');
insert into public.organization_members (organization_id, user_id, role)
select id, '00000000-0000-0000-0000-000000000002', 'owner'
from public.organizations where name = 'Other';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is((select count(*) from public.projects), 0::bigint, 'second organization cannot read Genesis projects');
select is((select count(*) from public.products), 0::bigint, 'second organization cannot read Genesis products');

reset role;
select lives_ok(
  $$select public.delete_connection_secret(
    (select id from public.integration_connections where name = 'Hotmart Principal')
  )$$,
  'credential revocation succeeds'
);
select is(
  public.get_connection_secret((select id from public.integration_connections where name = 'Hotmart Principal')),
  null::text,
  'revoked credential is absent from the decrypted view'
);
select is(
  (select status::text from public.integration_connections where name = 'Hotmart Principal'),
  'revoked',
  'revocation updates connection status'
);

select * from finish();
rollback;
