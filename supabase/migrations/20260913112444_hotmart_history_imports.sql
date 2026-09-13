create table public.hotmart_import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null, connection_id uuid not null, product_id uuid not null,
  requested_by uuid not null references auth.users(id),
  start_at timestamptz not null, end_at timestamptz not null check (end_at >= start_at),
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  cursor jsonb not null, processed integer not null default 0 check (processed >= 0),
  pages integer not null default 0, attempts integer not null default 0,
  lease_id uuid, lease_until timestamptz, run_after timestamptz not null default now(),
  error_message text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), finished_at timestamptz,
  foreign key (organization_id, project_id) references public.projects(organization_id,id),
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id,id),
  foreign key (organization_id, product_id) references public.products(organization_id,id)
);
create unique index hotmart_import_jobs_active_product on public.hotmart_import_jobs(product_id)
  where status in ('queued','running');
create index hotmart_import_jobs_queue on public.hotmart_import_jobs(run_after, created_at)
  where status in ('queued','running');
create index hotmart_import_jobs_project on public.hotmart_import_jobs(organization_id,project_id,created_at desc);
create index hotmart_import_jobs_connection on public.hotmart_import_jobs(connection_id);
create index hotmart_import_jobs_requester on public.hotmart_import_jobs(requested_by);
create index hotmart_import_jobs_product on public.hotmart_import_jobs(product_id);

create table public.hotmart_history_records (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  project_id uuid not null, connection_id uuid not null, product_id uuid not null,
  transaction_id text not null, purchase_status text not null,
  ordered_at timestamptz not null, approved_at timestamptz,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  payload jsonb not null, observed_at timestamptz not null,
  unique(connection_id,transaction_id),
  foreign key (organization_id,project_id) references public.projects(organization_id,id),
  foreign key (organization_id,connection_id) references public.integration_connections(organization_id,id),
  foreign key (organization_id,product_id) references public.products(organization_id,id)
);
create index hotmart_history_records_project on public.hotmart_history_records(organization_id,project_id,ordered_at desc,id);
create index hotmart_history_records_product on public.hotmart_history_records(product_id);
alter table public.hotmart_import_jobs enable row level security;
alter table public.hotmart_history_records enable row level security;
create policy hotmart_import_jobs_admin_read on public.hotmart_import_jobs for select to authenticated
  using (public.is_org_admin(organization_id));
create policy hotmart_history_records_admin_read on public.hotmart_history_records for select to authenticated
  using (public.is_org_admin(organization_id));
revoke all on public.hotmart_import_jobs, public.hotmart_history_records from public,anon,authenticated;
grant select on public.hotmart_import_jobs, public.hotmart_history_records to authenticated;
grant all on public.hotmart_import_jobs, public.hotmart_history_records to service_role;

-- A snapshot can prove that a previously approved transaction is no longer
-- approved, without supplying an accounting refund date or amount. Hold it out
-- of recognized revenue until a real reversal event permits ledger reconciliation.
create view public.recognized_sales_events with(security_invoker=true) as
select event.* from public.sales_events event
where not exists (
  select 1 from public.hotmart_history_records history
  where history.connection_id=event.connection_id and history.transaction_id=event.external_transaction_id
    and history.purchase_status in ('REFUNDED','CHARGEBACK','PARTIALLY_REFUNDED')
    and not exists (select 1 from public.sales_events refund where refund.connection_id=event.connection_id
      and refund.external_transaction_id=event.external_transaction_id and refund.event_type='PURCHASE_REFUNDED')
);
revoke all on public.recognized_sales_events from public,anon;
grant select on public.recognized_sales_events to authenticated,service_role;

create or replace view public.project_daily_metrics with(security_invoker=true) as
with traffic as (
  select organization_id,project_id,metric_date,sum(investment) as investment,sum(impressions) as impressions,
    sum(clicks) as clicks,sum(page_views) as page_views,sum(checkouts) as checkouts
  from public.traffic_metrics_daily group by organization_id,project_id,metric_date
), sales_per_event as (
  select event.id,event.organization_id,event.project_id,(event.event_at at time zone project.reporting_timezone)::date as metric_date,
    event.net_amount,coalesce(sum(case when coalesce(item.stage_type_snapshot,stage.stage_type)='core'
      then case when event.event_type='PURCHASE_REFUNDED' then -item.quantity else item.quantity end else 0 end),0) as core_sales
  from public.recognized_sales_events event join public.projects project on project.id=event.project_id
    left join public.sales_event_items item on item.sales_event_id=event.id
    left join public.funnel_stages stage on stage.id=item.funnel_stage_id
  where event.project_id is not null and event.event_type in ('PURCHASE_APPROVED','PURCHASE_COMPLETED','PURCHASE_REFUNDED')
  group by event.id,event.organization_id,event.project_id,event.event_at,event.net_amount,project.reporting_timezone
), sales as (
  select organization_id,project_id,metric_date,sum(net_amount) as revenue,sum(core_sales) as core_sales
  from sales_per_event group by organization_id,project_id,metric_date
)
select coalesce(traffic.organization_id,sales.organization_id) as organization_id,
  coalesce(traffic.project_id,sales.project_id) as project_id,coalesce(traffic.metric_date,sales.metric_date) as metric_date,
  coalesce(traffic.investment,0) as investment,coalesce(sales.revenue,0) as revenue,coalesce(traffic.impressions,0) as impressions,
  coalesce(traffic.clicks,0) as clicks,coalesce(traffic.page_views,0) as page_views,coalesce(traffic.checkouts,0) as checkouts,
  coalesce(sales.core_sales,0) as core_sales
from traffic full join sales on sales.organization_id=traffic.organization_id and sales.project_id=traffic.project_id and sales.metric_date=traffic.metric_date;

alter table public.checkout_recovery_attempts drop constraint checkout_recovery_attempts_external_kind_check;
alter table public.checkout_recovery_attempts add constraint checkout_recovery_attempts_external_kind_check
  check (external_kind in ('lead','invoice','transaction'));

create function public.start_hotmart_history_import(p_organization_id uuid, p_project_id uuid,
  p_product_id uuid, p_requested_by uuid, p_start date, p_end date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_product public.products; v_mapping public.product_mappings; v_id uuid;
  v_start timestamptz := p_start::timestamp at time zone 'America/Sao_Paulo';
  v_end timestamptz := (p_end + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if p_start is null or p_end is null or p_end < p_start or p_end > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Período inválido.' using errcode='22023';
  end if;
  if not exists (select 1 from public.organization_members where organization_id=p_organization_id
    and user_id=p_requested_by and role in ('owner','admin')) then
    raise exception 'Permissão administrativa necessária.' using errcode='42501';
  end if;
  if not exists (select 1 from public.projects where id=p_project_id and organization_id=p_organization_id and deleted_at is null) then
    raise exception 'Projeto não encontrado.' using errcode='22023';
  end if;
  select p.* into v_product from public.products p join public.integration_connections c on c.id=p.connection_id
    where p.id=p_product_id and p.organization_id=p_organization_id and c.provider='hotmart' and c.revoked_at is null for update of p;
  if not found then raise exception 'Produto Hotmart indisponível.' using errcode='22023'; end if;
  select * into v_mapping from public.product_mappings where product_id=p_product_id and project_id=p_project_id
    and effective_to is null for update;
  if not found then raise exception 'Vincule o produto na aba Produtos antes de importar.' using errcode='22023'; end if;
  -- Extending the chosen mapping never takes over another project's historical period.
  if exists (select 1 from public.product_mappings where product_id=p_product_id and id<>v_mapping.id
    and effective_from < greatest(v_end,v_mapping.effective_from) and coalesce(effective_to,'infinity') > v_start) then
    raise exception 'Este período possui outro vínculo de produto. Revise os vínculos ou reduza o período.' using errcode='22023';
  end if;
  select id into v_id from public.hotmart_import_jobs where product_id=p_product_id and status in ('queued','running');
  if v_id is not null then return v_id; end if;
  update public.product_mappings set effective_from=least(effective_from,v_start) where id=v_mapping.id;
  insert into public.hotmart_import_jobs(organization_id,project_id,connection_id,product_id,requested_by,start_at,end_at,cursor)
    values(p_organization_id,p_project_id,v_product.connection_id,p_product_id,p_requested_by,v_start,v_end-interval '1 millisecond',
      jsonb_build_object('statusIndex',0,'windowStart',extract(epoch from v_start)*1000)) returning id into v_id;
  return v_id;
end $$;

create function public.claim_hotmart_history_import()
returns setof public.hotmart_import_jobs language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  select id into v_id from public.hotmart_import_jobs
    where status in ('queued','running') and run_after<=now() and (lease_until is null or lease_until<now())
    order by run_after,created_at for update skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.hotmart_import_jobs set status='running',lease_id=gen_random_uuid(),
    lease_until=now()+interval '5 minutes',updated_at=now() where id=v_id returning *;
end $$;

create function public.apply_hotmart_history_page(p_job_id uuid,p_lease_id uuid,p_rows jsonb,p_next_cursor jsonb,p_observed_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
declare j public.hotmart_import_jobs; r jsonb; s jsonb; v_product public.products;
  v_payload jsonb; v_status text; v_transaction text; v_contact_id uuid; v_event_id uuid;
  v_existing public.hotmart_history_records;
  v_paid public.sales_events;
  v_email text; v_phone text; v_email_id uuid; v_phone_id uuid;
begin
  select * into j from public.hotmart_import_jobs where id=p_job_id for update;
  if not found or j.status<>'running' or j.lease_id is distinct from p_lease_id or j.lease_until<now() then
    raise exception 'Importação em processamento por outra execução.';
  end if;
  perform 1 from public.integration_connections where id=j.connection_id and revoked_at is null for update;
  if not found then raise exception 'Conexão revogada.'; end if;
  select * into v_product from public.products where id=j.product_id;
  if not exists (select 1 from public.product_mappings m join public.projects p on p.id=m.project_id
    where m.product_id=j.product_id and m.project_id=j.project_id and m.effective_from<=j.start_at
    and (m.effective_to is null or m.effective_to>j.end_at) and p.deleted_at is null) then
    raise exception 'O vínculo do produto mudou. Revise o projeto antes de continuar.';
  end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>20 then raise exception 'Lote inválido.'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    s:=r->'sale'; v_transaction:=s->>'externalTransactionId'; v_status:=r->>'status'; v_payload:=s->'payload';
    if s->>'productExternalId'<>v_product.external_id or (r->>'orderedAt')::timestamptz not between j.start_at and j.end_at then
      raise exception 'A Hotmart retornou um produto ou período diferente do solicitado.';
    end if;
    select * into v_existing from public.hotmart_history_records where connection_id=j.connection_id and transaction_id=v_transaction for update;
    if v_existing.project_id is not null and v_existing.project_id<>j.project_id then
      raise exception 'Esta transação já pertence a outro projeto.';
    end if;
    -- A live webhook received after the API request wins over that API snapshot.
    if v_existing.observed_at>p_observed_at then continue; end if;
    if v_existing.purchase_status in ('APPROVED','COMPLETE','REFUNDED','CHARGEBACK','PARTIALLY_REFUNDED')
      and v_status in ('STARTED','PRINTED_BILLET','WAITING_PAYMENT','UNDER_ANALISYS') then continue; end if;
    v_event_id:=null; v_contact_id:=null;
    if v_status in ('APPROVED','COMPLETE') and not exists (select 1 from public.sales_events where connection_id=j.connection_id
        and external_transaction_id=v_transaction and event_type='PURCHASE_REFUNDED') then
      select * into v_paid from public.sales_events where connection_id=j.connection_id and external_transaction_id=v_transaction
        and event_type in ('PURCHASE_APPROVED','PURCHASE_COMPLETED') limit 1;
      if v_paid.project_id is not null and v_paid.project_id<>j.project_id then raise exception 'Esta venda já pertence a outro projeto.'; end if;
      -- Preserve top-level webhook-only facts (e.g. order bump); nested enrichment
      -- is performed by the existing sales trigger and skips empty API fields.
      v_payload:=coalesce(v_paid.payload,'{}')||v_payload;
      select event_id into v_event_id from public.ingest_hotmart_sale(j.connection_id,
        'history:'||v_transaction, v_transaction,
        case when v_paid.event_type='PURCHASE_COMPLETED' then v_paid.event_type else s->>'eventType' end,(s->>'eventAt')::timestamptz,
        s->>'productExternalId',s->>'productName',(s->>'grossAmount')::numeric,(s->>'netAmount')::numeric,s->>'currency',v_payload);
      select payload,contact_id into v_payload,v_contact_id from public.sales_events where id=v_event_id;
      if not exists (select 1 from public.sales_events where id=v_event_id and project_id=j.project_id) then
        raise exception 'A venda não pôde ser vinculada ao projeto. Confira a moeda e o período.';
      end if;
    elsif v_status in ('APPROVED','COMPLETE') then
      v_status:='REFUNDED';
    end if;
    if v_contact_id is null then
      v_email:=nullif(lower(btrim(v_payload #>> '{contact,email}')),'');
      v_phone:=nullif(regexp_replace(coalesce(v_payload #>> '{contact,phone}',''),'[^0-9]','','g'),'');
      if v_email is not null and (length(v_email)>254 or strpos(v_email,'@')<=1) then v_email:=null; end if;
      if v_phone is not null and length(v_phone) not between 8 and 15 then v_phone:=null; end if;
      if v_email is not null or v_phone is not null then
        perform pg_advisory_xact_lock(hashtextextended('sale-contact:'||j.project_id::text,0));
        select id into v_email_id from public.contacts where project_id=j.project_id and normalized_email=v_email and archived_at is null;
        select id into v_phone_id from public.contacts where project_id=j.project_id and normalized_phone=v_phone and archived_at is null;
        if v_email_id is null or v_phone_id is null or v_email_id=v_phone_id then
          v_contact_id:=coalesce(v_email_id,v_phone_id);
          if v_contact_id is null then
            insert into public.contacts(organization_id,project_id,name,email,phone,source,first_seen_at,last_seen_at)
            values(j.organization_id,j.project_id,nullif(v_payload #>> '{contact,name}',''),v_email,v_phone,'hotmart',
              (r->>'orderedAt')::timestamptz,greatest((r->>'orderedAt')::timestamptz,p_observed_at)) returning id into v_contact_id;
          end if;
        end if;
      end if;
    end if;
    insert into public.hotmart_history_records(organization_id,project_id,connection_id,product_id,transaction_id,
      purchase_status,ordered_at,approved_at,currency,gross_amount,payload,observed_at)
    values(j.organization_id,j.project_id,j.connection_id,j.product_id,v_transaction,v_status,(r->>'orderedAt')::timestamptz,
      (r->>'approvedAt')::timestamptz,s->>'currency',(s->>'grossAmount')::numeric,v_payload,p_observed_at)
    on conflict(connection_id,transaction_id) do update set purchase_status=excluded.purchase_status,
      approved_at=coalesce(excluded.approved_at,hotmart_history_records.approved_at),
      payload=excluded.payload,observed_at=excluded.observed_at;

    if v_status in ('STARTED','PRINTED_BILLET','WAITING_PAYMENT','UNDER_ANALISYS','OVERDUE','EXPIRED','CANCELLED') then
      insert into public.checkout_recovery_attempts(organization_id,project_id,connection_id,product_id,contact_id,
        external_kind,external_id,status,amount,currency,first_seen_at,last_seen_at,metadata)
      values(j.organization_id,j.project_id,j.connection_id,j.product_id,v_contact_id,'transaction',v_transaction,
        case when v_status in ('OVERDUE','EXPIRED') then 'expired' when v_status='CANCELLED' then 'failed' else 'pending' end,
        (s->>'grossAmount')::numeric,s->>'currency',p_observed_at,p_observed_at,v_payload)
      on conflict(connection_id,external_kind,external_id) do update set last_seen_at=excluded.last_seen_at,
        status=excluded.status,metadata=excluded.metadata,contact_id=coalesce(excluded.contact_id,checkout_recovery_attempts.contact_id)
        where checkout_recovery_attempts.status<>'recovered';
    elsif v_status in ('APPROVED','COMPLETE') then
      update public.checkout_recovery_attempts set status='recovered',recovered_at=(r->>'approvedAt')::timestamptz,
        last_seen_at=p_observed_at,contact_id=coalesce(v_contact_id,contact_id)
        where connection_id=j.connection_id and external_kind='transaction' and external_id=v_transaction
        and first_seen_at<(r->>'approvedAt')::timestamptz and status<>'recovered';
    end if;
  end loop;
  update public.hotmart_import_jobs set processed=processed+jsonb_array_length(p_rows),pages=pages+1,
    status=case when p_next_cursor is null then 'completed' else 'queued' end,
    cursor=coalesce(p_next_cursor,cursor),lease_id=null,lease_until=null,attempts=0,error_message=null,
    run_after=now(),updated_at=now(),finished_at=case when p_next_cursor is null then now() end where id=j.id;
  return jsonb_array_length(p_rows);
end $$;

create function public.observe_hotmart_history_webhook()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.payload->>'import_source'='hotmart_api' then return new; end if;
  update public.hotmart_history_records set
    purchase_status=case new.event_type when 'PURCHASE_REFUNDED' then 'REFUNDED' when 'PURCHASE_COMPLETED' then 'COMPLETE' else 'APPROVED' end,
    payload=payload||new.payload,observed_at=clock_timestamp()
    where connection_id=new.connection_id and transaction_id=new.external_transaction_id
    and (new.event_type='PURCHASE_REFUNDED' or purchase_status not in ('REFUNDED','CHARGEBACK','PARTIALLY_REFUNDED'));
  if new.event_type in ('PURCHASE_APPROVED','PURCHASE_COMPLETED') then
    update public.checkout_recovery_attempts set status='recovered',recovered_at=new.event_at,
      last_seen_at=greatest(clock_timestamp(),last_seen_at),contact_id=coalesce(new.contact_id,contact_id)
      where connection_id=new.connection_id and external_kind='transaction' and external_id=new.external_transaction_id
      and first_seen_at<new.event_at and status<>'recovered';
  end if;
  return new;
end $$;
create trigger hotmart_history_webhook_observation after insert or update on public.sales_events
  for each row when (new.event_type in ('PURCHASE_APPROVED','PURCHASE_COMPLETED','PURCHASE_REFUNDED'))
  execute function public.observe_hotmart_history_webhook();

create function public.get_hotmart_history_job_token()
returns text language sql stable security definer set search_path='' as $$
  select decrypted_secret from vault.decrypted_secrets where name='genesis_hotmart_history_job_token' limit 1
$$;
revoke all on function public.start_hotmart_history_import(uuid,uuid,uuid,uuid,date,date),
  public.claim_hotmart_history_import(),public.apply_hotmart_history_page(uuid,uuid,jsonb,jsonb,timestamptz),
  public.observe_hotmart_history_webhook(),public.get_hotmart_history_job_token() from public,anon,authenticated;
grant execute on function public.start_hotmart_history_import(uuid,uuid,uuid,uuid,date,date),
  public.claim_hotmart_history_import(),public.apply_hotmart_history_page(uuid,uuid,jsonb,jsonb,timestamptz),
  public.get_hotmart_history_job_token() to service_role;
