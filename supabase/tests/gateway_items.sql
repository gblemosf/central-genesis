-- Run after the migration, inside a transaction that is always rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
set local statement_timeout='25s';

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gateway-items@example.invalid','',now(),'{}','{}',now(),now());
select public.bootstrap_organization('00000000-0000-0000-0000-000000000101','Gateway Items Test');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select public.create_connection_with_secret((select id from public.organizations where name='Gateway Items Test'),'Gateway Items Connection','payt',
  jsonb_build_object('version',1,'provider','payt','webhookToken',repeat('a',64))::text);
select public.create_project_with_defaults((select id from public.organizations where name='Gateway Items Test'),
  'Gateway Items Project','gateway-items-test','Synthetic Expert',null,'payt',0,0,null,null);
reset role;

insert into public.products (organization_id,connection_id,external_id,name,current_price,currency,source)
select c.organization_id,c.id,p.external_id,p.name,p.price,'BRL','provider'
from public.integration_connections c
cross join (values ('gateway-core','Synthetic Core',297),('gateway-bump','Synthetic Bump',47)) p(external_id,name,price)
where c.name='Gateway Items Connection';
insert into public.product_mappings (organization_id,project_id,product_id,funnel_stage_id,effective_from)
select p.organization_id,project.id,p.id,s.id,'2000-01-01T00:00:00Z'
from public.products p
join public.integration_connections c on c.id=p.connection_id and c.name='Gateway Items Connection'
join public.projects project on project.organization_id=p.organization_id and project.slug='gateway-items-test'
join public.funnel_stages s on s.project_id=project.id
  and s.stage_type=case when p.external_id='gateway-core' then 'core'::public.funnel_stage_type else 'order_bump'::public.funnel_stage_type end;

select lives_ok($test$
do $$
declare e jsonb; r jsonb; connection uuid; sale uuid;
begin
  select id into strict connection from public.integration_connections where name='Gateway Items Connection';
  e:=jsonb_build_object('provider','payt','status','pending','transaction_id','genesis-validation-items',
    'occurred_at',now(),'currency','BRL','external_kind','invoice','product_external_id','gateway-core','product_name','Synthetic Core',
    'financial',jsonb_build_object('gross',344,'platform_fee',20.72,'net_after_fees',323.28,'payout',null,'payout_source','unknown'),
    'contact',jsonb_build_object('name','Pessoa de validação','email','integration-test@example.invalid','phone','5511999990000'),
    'attribution',jsonb_build_object('utm',jsonb_build_object('source','validation','campaign','rollback')),
    'items',jsonb_build_array(
      jsonb_build_object('product_external_id','gateway-core','product_name','Synthetic Core','quantity',1,'is_order_bump',false,'financial',jsonb_build_object('gross',297,'platform_fee',17.72,'net_after_fees',279.28)),
      jsonb_build_object('product_external_id','gateway-bump','product_name','Synthetic Bump','quantity',1,'is_order_bump',true,'financial',jsonb_build_object('gross',47,'platform_fee',3,'net_after_fees',44))));
  r:=public.store_gateway_items(connection,e);
  if r ->> 'state'<>'processed' then raise exception 'pending processing failed: %',r; end if;
  if exists(select 1 from public.sales_events where connection_id=connection and external_transaction_id='genesis-validation-items') then raise exception 'pending counted as sale'; end if;
  e:=jsonb_set(e,'{status}','"paid"');
  r:=public.store_gateway_items(connection,e);
  if r ->> 'state'<>'processed' then raise exception 'sale processing failed: %',r; end if;
  perform public.store_gateway_items(connection,e);
  select id into sale from public.sales_events where connection_id=connection and external_transaction_id='genesis-validation-items' and event_type='PURCHASE_APPROVED';
  if (select count(*) from public.sales_events where connection_id=connection and external_transaction_id='genesis-validation-items')<>1 then raise exception 'duplicate sale counted'; end if;
  if (select count(*) from public.sales_event_items where sales_event_id=sale)<>2 or
     (select sum(gross_amount) from public.sales_event_items where sales_event_id=sale)<>344 or
     (select sum(net_amount) from public.sales_event_items where sales_event_id=sale)<>323.28 then raise exception 'item totals wrong'; end if;
  if not exists(select 1 from public.checkout_recovery_attempts where connection_id=connection and external_id='genesis-validation-items' and status='recovered') then raise exception 'recovery not identified'; end if;
  e:=jsonb_set(e,'{occurred_at}',to_jsonb(now()+interval '2 minute'));
  e:=jsonb_set(e,'{attribution,utm,source}','"newest"'); perform public.store_gateway_items(connection,e);
  e:=jsonb_set(e,'{occurred_at}',to_jsonb(now()+interval '1 minute'));
  e:=jsonb_set(e,'{attribution,utm,source}','"older"'); perform public.store_gateway_items(connection,e);
  if (select payload #>> '{attribution,utm,source}' from public.sales_events where id=sale)<>'newest' then raise exception 'out-of-order delivery overwrote tracking'; end if;
  e:=jsonb_set(e,'{status}','"refunded"'); perform public.store_gateway_items(connection,e); perform public.store_gateway_items(connection,e);
  if (select count(*) from public.sales_events where connection_id=connection and external_transaction_id='genesis-validation-items' and event_type='PURCHASE_REFUNDED')<>1 then raise exception 'duplicate reversal counted'; end if;
  if (select sum(gross_amount) from public.sales_events where connection_id=connection and external_transaction_id='genesis-validation-items')<>0 then raise exception 'reversal sign wrong'; end if;
  e:=jsonb_set(e,'{transaction_id}','"genesis-validation-unmapped"'); e:=jsonb_set(e,'{status}','"paid"');
  e:=jsonb_set(e,'{items,0,product_external_id}','"genesis-unmapped-one"'); e:=jsonb_set(e,'{items,1,product_external_id}','"genesis-unmapped-two"');
  r:=public.store_gateway_items(connection,e);
  if r ->> 'state'<>'unmapped' or (select count(*) from public.products where connection_id=connection and external_id in ('genesis-unmapped-one','genesis-unmapped-two'))<>2 then raise exception 'whole invoice discovery failed'; end if;
  if exists(select 1 from public.sales_events where connection_id=connection and external_transaction_id='genesis-validation-unmapped') then raise exception 'unmapped invoice counted'; end if;
  e:=jsonb_set(e,'{provider}','"assiny"');
  begin perform public.store_gateway_items(connection,e); raise exception 'provider isolation failed'; exception when sqlstate 'P0001' then
    if sqlerrm<>'active gateway connection required' then raise; end if; end;
  if has_function_privilege('anon','public.store_gateway_items(uuid,jsonb)','EXECUTE') or
     has_function_privilege('authenticated','public.store_gateway_items(uuid,jsonb)','EXECUTE') then raise exception 'internal processor publicly callable'; end if;
end;
$$;
$test$, 'gateway items preserve totals, deduplication, refunds, recovery, delivery order and provider isolation');
select lives_ok($test$
do $$
declare e jsonb; r jsonb; connection uuid; sale uuid;
begin
  select id into strict connection from public.integration_connections where name='Gateway Items Connection';
  e:=jsonb_build_object('provider','payt','status','paid','transaction_id','invoice-only-test','occurred_at',now(),'currency','BRL','contract_version',1,
    'financial_scope','invoice','financial',jsonb_build_object('gross',437.5,'platform_fee',92.66,'net_after_fees',344.84,'payout',172.42,
      'reconciliation',jsonb_build_object('kind','invoice_only','gross_delta',93.5)),
    'items',jsonb_build_array(
      jsonb_build_object('product_external_id','gateway-core','product_name','Core','quantity',1,'financial',jsonb_build_object('gross',297,'platform_fee',null,'net_after_fees',null)),
      jsonb_build_object('product_external_id','gateway-bump','product_name','Bump','quantity',1,'financial',jsonb_build_object('gross',47,'platform_fee',null,'net_after_fees',null))));
  r:=public.store_gateway_items(connection,e);
  if r ->> 'state'<>'processed' then raise exception 'invoice-only processing failed'; end if;
  perform public.store_gateway_items(connection,e);
  select id into strict sale from public.sales_events where connection_id=connection and external_transaction_id='invoice-only-test';
  if (select gross_amount from public.sales_events where id=sale)<>437.5 or (select net_amount from public.sales_events where id=sale)<>344.84 then raise exception 'invoice totals changed'; end if;
  if (select count(*) from public.sales_event_items where sales_event_id=sale and net_amount is null)<>2 or
    (select sum(gross_amount) from public.sales_event_items where sales_event_id=sale)<>344 then raise exception 'item values were allocated'; end if;
  e:=e || jsonb_build_object('status','refunded','financial_origin','original_sale','occurred_at',now()+interval '1 minute',
    'financial',jsonb_build_object('gross',0,'platform_fee',0,'net_after_fees',0));
  perform public.store_gateway_items(connection,e);perform public.store_gateway_items(connection,e);
  if (select count(*) from public.sales_events where connection_id=connection and external_transaction_id='invoice-only-test')<>2 or
    (select sum(net_amount) from public.sales_events where connection_id=connection and external_transaction_id='invoice-only-test')<>0 then raise exception 'original invoice was not reversed exactly once'; end if;
  e:=jsonb_set(e,'{transaction_id}','"original-missing"');r:=public.store_gateway_items(connection,e);
  if r ->> 'reason'<>'original_sale_required' or exists(select 1 from public.sales_events where connection_id=connection and external_transaction_id='original-missing') then raise exception 'refund without original entered ledger'; end if;
end;
$$;
$test$,'invoice totals, unknown item fees, replay and original-sale refunds remain distinct');

select lives_ok($test$
select public.validate_gateway_finances('{"status":"paid","financial_scope":"invoice","financial":{"gross":345.80,"platform_fee":19.81,"net_after_fees":325.99,"reconciliation":{"kind":"reported_item_rounding","gross_delta":0,"platform_fee_delta":-0.01,"net_after_fees_delta":0.01}},"items":[{"financial":{"gross":282.15,"platform_fee":16.17,"net_after_fees":265.98}},{"financial":{"gross":63.65,"platform_fee":3.65,"net_after_fees":60}}]}','assiny');
$test$,'Assiny preserves the separately reported invoice cent');
select throws_ok($test$
select public.validate_gateway_finances('{"status":"paid","financial_scope":"invoice","financial":{"gross":345.80,"platform_fee":19.80,"net_after_fees":326,"reconciliation":{"kind":"reported_item_rounding","gross_delta":0,"platform_fee_delta":-0.02,"net_after_fees_delta":0.02}},"items":[{"financial":{"gross":282.15,"platform_fee":16.17,"net_after_fees":265.98}},{"financial":{"gross":63.65,"platform_fee":3.65,"net_after_fees":60}}]}','assiny');
$test$,'P0001','invalid gateway rounding difference','a larger mismatch is refused rather than hidden');
select is(public.receive_payt_postback((select id from public.integration_connections where name='Gateway Items Connection'),repeat('7',64),'{"status":"refund_requested"}',null,'non_financial_event') ->> 'state','ignored','refund requests are retained without creating sales or reversals');
select ok(not has_function_privilege('authenticated','public.validate_gateway_finances(jsonb,text)','EXECUTE'),'financial validation is internal');
select lives_ok($test$
do $$
declare connection uuid; e jsonb; r jsonb;
begin
  select id into strict connection from public.integration_connections where name='Gateway Items Connection';
  e:=jsonb_build_object('provider','payt','status','abandoned','transaction_id','payt-cart-identity','external_kind','lead',
    'occurred_at',now(),'currency','BRL','financial',jsonb_build_object('gross',297),
    'items',jsonb_build_array(jsonb_build_object('product_external_id','gateway-core','product_name','Core','quantity',1,'financial',jsonb_build_object('gross',297))));
  r:=public.store_gateway_items(connection,e);perform public.store_gateway_items(connection,e);
  if r ->> 'state'<>'processed' or (select count(*) from public.checkout_recovery_attempts where connection_id=connection and external_kind='lead' and external_id='payt-cart-identity' and status='abandoned')<>1 then raise exception 'Payt cart did not become one lead recovery attempt'; end if;
  if exists(select 1 from public.sales_events where connection_id=connection and external_transaction_id='payt-cart-identity') then raise exception 'abandonment became revenue'; end if;
end;
$$;
$test$,'Payt cart identity uses the canonical lead recovery contract, without duplicate attempts or revenue');
select * from finish();
rollback;
