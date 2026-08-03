begin;

create extension if not exists pgtap with schema extensions;
select plan(90);

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
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'viewer@example.com', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

select lives_ok(
  $$select public.bootstrap_organization(
    '00000000-0000-0000-0000-000000000001', 'Genesis'
  )$$,
  'bootstrap creates the first organization'
);
select is((select count(*) from public.organizations), 1::bigint, 'one organization exists');
insert into public.organization_members (organization_id, user_id, role)
select id, '00000000-0000-0000-0000-000000000003', 'viewer'
from public.organizations where name = 'Genesis';
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
select lives_ok(
  $$select public.set_project_meta_account(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.provider_accounts where external_id = 'act_123')
  )$$,
  'saving the same Meta account is idempotent'
);
select ok(
  (select provider_account_id is not null from public.traffic_metrics_daily),
  'saving a Meta account preserves its historical metric identity'
);
insert into public.provider_accounts (
  organization_id, connection_id, external_id, name, account_type, currency, timezone, is_active
)
select organization.id, connection.id, 'act_456', 'Conta Meta Nova', 'meta_ad_account', 'BRL', 'America/Sao_Paulo', true
from public.organizations organization
join public.integration_connections connection
  on connection.organization_id = organization.id
where organization.name = 'Genesis' and connection.name = 'Meta Principal';
select lives_ok(
  $$select public.set_project_meta_account(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.provider_accounts where external_id = 'act_456')
  )$$,
  'owner can replace the linked Meta account'
);
select ok(
  (
    select metric.provider_account_id = account.id
    from public.traffic_metrics_daily metric
    join public.provider_accounts account on account.external_id = 'act_123'
  ),
  'replacing a Meta account keeps historical metrics on the original account'
);
select lives_ok(
  $$select public.set_project_meta_account(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.provider_accounts where external_id = 'act_123')
  )$$,
  'owner can relink the original Meta account without losing history'
);
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
select ok(
  (
    select product_name_snapshot = 'Produto Teste'
      and stage_type_snapshot = 'core'
    from public.sales_event_items
  ),
  'sale item stores product and funnel snapshots'
);
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
select lives_ok(
  $$select public.create_project_funnel_stage(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    'Checkout bonus', 'order_bump', '#61d6c8'
  )$$,
  'owner creates a manual funnel stage'
);
select lives_ok(
  $$select public.reorder_project_funnel_stages(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    array(
      select id from public.funnel_stages
      where project_id = (select id from public.projects where slug = 'projeto-teste')
        and archived_at is null
      order by position desc
    )
  )$$,
  'owner reorders every active funnel stage atomically'
);
select is(
  (select position from public.funnel_stages where name = 'Checkout bonus'),
  1,
  'reordered stage receives its requested position'
);
select lives_ok(
  $$select public.update_project_funnel_stage(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.funnel_stages where name = 'Checkout bonus'),
    'Checkout bonus', 'order_bump', '#61d6c8', true
  )$$,
  'owner archives a funnel stage without deleting it'
);
select ok(
  (select archived_at is not null from public.funnel_stages where name = 'Checkout bonus'),
  'archived funnel stage remains stored'
);
select lives_ok(
  $$select public.create_project_product(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    null, 'manual-1', 'Produto manual', 47, 'BRL', null
  )$$,
  'owner creates a manual product without a provider connection'
);
select ok(
  (
    select source = 'manual' and connection_id is null
    from public.products where external_id = 'manual-1'
  ),
  'manual product records its source without a fake connection'
);
select lives_ok(
  $$select public.update_project_product(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.products where external_id = 'manual-1'),
    'manual-1', 'Produto manual editado', 57, 'BRL',
    (
      select id from public.funnel_stages
      where project_id = (select id from public.projects where slug = 'projeto-teste')
        and stage_type = 'upsell' and archived_at is null
    )
  )$$,
  'owner edits and maps a manual product'
);
select is(
  (select name from public.products where external_id = 'manual-1'),
  'Produto manual editado',
  'manual product edit is persisted'
);
select lives_ok(
  $$select public.set_project_product_archived(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.products where external_id = 'manual-1'),
    true
  )$$,
  'owner archives a product and closes its active mapping'
);
select ok(
  (
    select product.archived_at is not null
      and not exists (
        select 1 from public.product_mappings mapping
        where mapping.product_id = product.id and mapping.effective_to is null
      )
    from public.products product where product.external_id = 'manual-1'
  ),
  'archived product remains stored without an active mapping'
);
select lives_ok(
  $$select public.set_project_product_archived(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.products where external_id = 'manual-1'),
    false
  )$$,
  'owner restores an archived product'
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
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.update_project_funnel_stage(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (
      select id from public.funnel_stages
      where project_id = (select id from public.projects where slug = 'projeto-teste')
        and stage_type = 'core' and archived_at is null
    ),
    'Core renomeado', 'upsell', null, false
  )$$,
  'owner can edit a historical funnel classification'
);
reset role;
select is(
  (select core_sales from public.project_daily_metrics where metric_date = '2026-07-27'),
  1::numeric,
  'stage edits do not reclassify historical core sales'
);
select ok(
  (select mapped from public.ingest_hotmart_sale(
    (select id from public.integration_connections where name = 'Hotmart Principal'),
    'evt-future', 'txn-future', 'PURCHASE_COMPLETED',
    pg_catalog.clock_timestamp(),
    'product-1', 'Produto Teste', 100, 90, 'BRL', '{}'::jsonb
  )),
  'sale after a stage edit uses the new mapping version'
);
select is(
  (
    select item.stage_type_snapshot
    from public.sales_event_items item
    join public.sales_events event on event.id = item.sales_event_id
    where event.external_event_id = 'evt-future'
  ),
  'upsell'::public.funnel_stage_type,
  'future sale uses the edited funnel classification'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.update_project_funnel_stage(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    (select id from public.funnel_stages where name = 'Core renomeado'),
    'Core renomeado', 'upsell', null, true
  )$$,
  'owner archives a stage while keeping its mapping history'
);
reset role;
select ok(
  (select mapped from public.ingest_hotmart_sale(
    (select id from public.integration_connections where name = 'Hotmart Principal'),
    'evt-delayed', 'txn-delayed', 'PURCHASE_COMPLETED', '2026-07-28T12:00:00Z',
    'product-1', 'Produto Teste', 100, 90, 'BRL', '{}'::jsonb
  )),
  'delayed webhook uses the mapping valid before the stage was archived'
);
select is(
  (
    select item.stage_type_snapshot
    from public.sales_event_items item
    join public.sales_events event on event.id = item.sales_event_id
    where event.external_event_id = 'evt-delayed'
  ),
  'core'::public.funnel_stage_type,
  'delayed webhook keeps the funnel type captured by the historical mapping'
);
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

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.create_connection_with_secret(
    (select id from public.organizations where name = 'Genesis'),
    'Kiwify Principal', 'kiwify', 'kiwify-credential-bundle', null, null, null
  )$$,
  'owner creates a second sales connection'
);
reset role;
update public.integration_connections
set status = 'connected', last_verified_at = now()
where name = 'Kiwify Principal';
insert into public.products (
  organization_id, connection_id, external_id, name, current_price, currency,
  source, provider_name, provider_price, provider_currency
)
select organization.id, connection.id, 'kiwify-product-1', 'Produto Kiwify', 197,
       'BRL', 'provider', 'Produto Kiwify', 197, 'BRL'
from public.organizations organization
join public.integration_connections connection
  on connection.organization_id = organization.id
where organization.name = 'Genesis' and connection.name = 'Kiwify Principal';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.create_project_with_funnel(
    (select id from public.organizations where name = 'Genesis'),
    'Projeto Editavel', 'projeto-editavel', 'Expert Editavel', null,
    'kiwify',
    (select id from public.integration_connections where name = 'Kiwify Principal'),
    200000, 55,
    jsonb_build_array(
      jsonb_build_object(
        'name', 'Produto principal', 'type', 'core', 'color', null,
        'productId', (select id::text from public.products where external_id = 'kiwify-product-1')
      ),
      jsonb_build_object(
        'name', 'Segundo passo', 'type', 'upsell', 'color', '#61d6c8',
        'productId', null
      )
    ),
    null, null
  )$$,
  'owner creates the submitted funnel atomically'
);
select is(
  (select count(*) from public.funnel_stages
   where project_id = (select id from public.projects where slug = 'projeto-editavel')),
  2::bigint,
  'editable onboarding persists exactly the submitted stages'
);
select is(
  (select pg_catalog.string_agg(stage_type::text, ',' order by position)
   from public.funnel_stages
   where project_id = (select id from public.projects where slug = 'projeto-editavel')),
  'core,upsell',
  'editable onboarding preserves stage order and types'
);
select ok(
  exists(
    select 1
    from public.product_mappings mapping
    join public.products product on product.id = mapping.product_id
    join public.funnel_stages stage on stage.id = mapping.funnel_stage_id
    where mapping.project_id = (select id from public.projects where slug = 'projeto-editavel')
      and product.external_id = 'kiwify-product-1'
      and stage.stage_type = 'core'
      and mapping.effective_to is null
  ),
  'editable onboarding associates the selected product with its stage'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.create_hubla_webhook_connection(
    (select id from public.organizations where name = 'Genesis'),
    'Hubla Principal'
  )$$,
  'owner generates one shared Hubla webhook endpoint'
);
reset role;
select lives_ok(
  $$select * from public.ingest_hubla_webhook(
    (select id from public.integration_connections where name = 'Hubla Principal'),
    'hubla-sandbox-1', 'invoice.payment_succeeded', '2.0.0',
    '2026-08-02T10:00:00Z', 'invoice-sandbox', 1,
    'hubla-product-sandbox', 'Produto sandbox', 100, 90, 'BRL', true,
    '{"type":"invoice.payment_succeeded"}'::jsonb
  )$$,
  'sandbox webhook confirms the Hubla endpoint without changing production metrics'
);
select ok(
  (select status = 'connected' and last_verified_at is not null
   from public.integration_connections where name = 'Hubla Principal'),
  'valid Hubla webhook marks the connection as confirmed'
);
select ok(
  not (select mapped from public.ingest_hubla_webhook(
    (select id from public.integration_connections where name = 'Hubla Principal'),
    'hubla-sale-1', 'invoice.payment_succeeded', '2.0.0',
    '2026-08-02T11:00:00Z', 'invoice-1', 1,
    'hubla-product-1', 'Produto Hubla', 100, 90, 'BRL', false,
    '{"type":"invoice.payment_succeeded"}'::jsonb
  )),
  'unmapped Hubla sale is quarantined'
);
select ok(
  exists(
    select 1 from public.products
    where external_id = 'hubla-product-1' and source = 'provider'
  ),
  'Hubla event discovers its product'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.create_project_with_funnel(
    (select id from public.organizations where name = 'Genesis'),
    'Projeto Hubla', 'projeto-hubla', 'Expert Hubla', null,
    'hubla',
    (select id from public.integration_connections where name = 'Hubla Principal'),
    100000, 60,
    jsonb_build_array(jsonb_build_object(
      'name', 'Produto principal', 'type', 'core', 'color', null,
      'productId', (select id::text from public.products where external_id = 'hubla-product-1')
    )),
    null, null
  )$$,
  'owner routes a Hubla product to a project'
);
reset role;
select ok(
  (select mapped from public.ingest_hubla_webhook(
    (select id from public.integration_connections where name = 'Hubla Principal'),
    'hubla-sale-2', 'invoice.payment_succeeded', '2.0.0',
    '2026-08-02T12:00:00Z', 'invoice-2', 2,
    'hubla-product-1', 'Produto Hubla', 100, 90, 'BRL', false,
    '{"type":"invoice.payment_succeeded"}'::jsonb
  )),
  'mapped Hubla sale is assigned to the correct project'
);
select ok(
  (select duplicate from public.ingest_hubla_webhook(
    (select id from public.integration_connections where name = 'Hubla Principal'),
    'hubla-sale-2', 'invoice.payment_succeeded', '2.0.0',
    '2026-08-02T12:00:00Z', 'invoice-2', 2,
    'hubla-product-1', 'Produto Hubla', 100, 90, 'BRL', false,
    '{"type":"invoice.payment_succeeded"}'::jsonb
  )),
  'Hubla idempotency key prevents duplicate sales'
);
update public.product_mappings
set effective_to = '2026-08-02T12:30:00Z'
where product_id = (select id from public.products where external_id = 'hubla-product-1')
  and effective_to is null;
insert into public.product_mappings (
  organization_id, project_id, product_id, funnel_stage_id, effective_from,
  funnel_stage_name_snapshot, stage_type_snapshot
)
select project.organization_id, project.id, product.id, stage.id,
       '2026-08-02T12:30:00Z', stage.name, stage.stage_type
from public.projects project
join public.funnel_stages stage on stage.project_id = project.id
cross join public.products product
where project.slug = 'projeto-teste'
  and stage.stage_type = 'core'
  and product.external_id = 'hubla-product-1'
limit 1;
select ok(
  (select mapped from public.ingest_hubla_webhook(
    (select id from public.integration_connections where name = 'Hubla Principal'),
    'hubla-refund-2', 'invoice.refunded', '2.0.0',
    '2026-08-02T13:00:00Z', 'invoice-2', 3,
    'hubla-product-1', 'Produto Hubla', 100, 90, 'BRL', false,
    '{"type":"invoice.refunded","customer":{"email":"private@example.com"}}'::jsonb
  )),
  'Hubla refund follows the original sale after product remapping'
);
select is(
  (select project.slug
   from public.sales_events event
   join public.projects project on project.id = event.project_id
   where event.external_event_id = 'hubla-refund-2'),
  'projeto-hubla',
  'Hubla refund preserves the project assigned to the original transaction'
);
select is(
  (select revenue from public.project_daily_metrics
   where project_id = (select id from public.projects where slug = 'projeto-hubla')
     and metric_date = '2026-08-02'),
  0::numeric,
  'Hubla refund is deducted from daily revenue'
);
select is(
  (select core_sales from public.project_daily_metrics
   where project_id = (select id from public.projects where slug = 'projeto-hubla')
     and metric_date = '2026-08-02'),
  0::numeric,
  'Hubla refund reverses the core sale count'
);
select ok(
  not (select payload ? 'customer'
       from public.hubla_webhook_events
       where idempotency_key = 'hubla-refund-2'),
  'Hubla raw event storage removes customer PII'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select is(
  (select count(*) from public.hubla_webhook_events),
  0::bigint,
  'viewer cannot read raw Hubla webhook events'
);
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select ok(
  (select count(*) > 0 from public.hubla_webhook_events),
  'owner can inspect minimized Hubla webhook events'
);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.import_project_csv_metrics(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    '[{"date":"2026-08-01","invest":50,"impressions":1000,"clicks":100,"pageviews":80,"checkouts":10}]'::jsonb,
    '[{"date":"2026-08-01","core":2,"ob1":1,"ob2":0,"ob3":0,"ob4":0,"ob5":0,"up1":0,"up2":0,"ds1":0,"ds2":0,"fat_liquido":120}]'::jsonb,
    '2026-08-01',
    '2026-08-01'
  )$$,
  'owner imports both CSV metric sets atomically'
);
select is(
  (select invest from public.metricas_trafego where projeto = 'projeto-teste' and date = '2026-08-01'),
  50::numeric,
  'CSV traffic metric is persisted'
);
select is(
  (select core from public.metricas_vendas where projeto = 'projeto-teste' and date = '2026-08-01'),
  2,
  'CSV sales metric is persisted'
);
select is(
  (select settings #>> '{metrics,periodStart}' from public.projects where slug = 'projeto-teste'),
  '2026-08-01',
  'CSV import updates the project reporting period in the same transaction'
);

reset role;
insert into public.organizations (name) values ('Other');
insert into public.organization_members (organization_id, user_id, role)
select id, '00000000-0000-0000-0000-000000000002', 'owner'
from public.organizations where name = 'Other';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is((select count(*) from public.projects), 0::bigint, 'second organization cannot read Genesis projects');
select is((select count(*) from public.products), 0::bigint, 'second organization cannot read Genesis products');
select throws_ok(
  $$select public.import_project_csv_metrics(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    '[]'::jsonb,
    '[{"date":"2026-08-01","core":1,"fat_liquido":20}]'::jsonb,
    '2026-08-01',
    '2026-08-01'
  )$$,
  '42501',
  'administrator permission required',
  'another organization cannot import metrics into a Genesis project'
);
select lives_ok(
  $$select public.create_project_with_defaults(
    (select id from public.organizations where name = 'Other'),
    'Projeto Outro', 'projeto-teste', 'Expert Outro', null,
    'hotmart', 100000, 60, null, null
  )$$,
  'second organization can reuse a project slug'
);
select lives_ok(
  $$select public.import_project_csv_metrics(
    (select id from public.organizations where name = 'Other'),
    (select id from public.projects where slug = 'projeto-teste'),
    '[{"date":"2026-08-01","invest":75,"impressions":1500,"clicks":120,"pageviews":90,"checkouts":12}]'::jsonb,
    '[]'::jsonb,
    '2026-08-01',
    '2026-08-01'
  )$$,
  'different organizations can import the same slug and date without collision'
);
select is(
  (select invest from public.metricas_trafego where projeto = 'projeto-teste' and date = '2026-08-01'),
  75::numeric,
  'tenant RLS exposes only the second organization metric after a slug collision'
);

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
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select lives_ok(
  $$select public.set_project_meta_account(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.projects where slug = 'projeto-teste'),
    null
  )$$,
  'owner can unlink Meta without deleting its history'
);
reset role;
update public.integration_connections
set status = 'revoked', revoked_at = now()
where name = 'Meta Principal';
insert into public.sync_runs (
  organization_id, project_id, connection_id, job_type, status, started_at, finished_at
)
select organization.id, project.id, connection.id, 'meta_history', 'succeeded', now(), now()
from public.organizations organization
join public.projects project on project.organization_id = organization.id
join public.integration_connections connection
  on connection.organization_id = organization.id
where organization.name = 'Genesis'
  and project.slug = 'projeto-teste'
  and connection.name = 'Meta Principal';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select throws_ok(
  $$select public.delete_empty_integration_connection(
    (select id from public.organizations where name = 'Genesis'),
    (select id from public.integration_connections where name = 'Meta Principal')
  )$$,
  'P0001',
  'connection has historical data',
  'connection with sync history cannot be deleted'
);
reset role;

select * from finish();
rollback;
