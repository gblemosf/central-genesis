create table public.checkout_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  connection_id uuid not null,
  product_id uuid,
  contact_id uuid,
  latest_webhook_event_id uuid references public.hubla_webhook_events(id) on delete set null,
  external_kind text not null check (external_kind in ('lead', 'invoice')),
  external_id text not null,
  status text not null check (
    status in ('abandoned', 'pending', 'failed', 'expired', 'recovered')
  ),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  offer_external_id text,
  checkout_url text,
  utm_campaign_id uuid,
  utm_term text,
  utm_content text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  recovered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, id),
  unique (connection_id, external_kind, external_id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, connection_id)
    references public.integration_connections(organization_id, id) on delete restrict,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete set null (product_id),
  foreign key (organization_id, project_id, contact_id)
    references public.contacts(organization_id, project_id, id) on delete set null (contact_id),
  foreign key (organization_id, project_id, utm_campaign_id)
    references public.utm_campaigns(organization_id, project_id, id)
    on delete set null (utm_campaign_id),
  check (pg_catalog.length(pg_catalog.btrim(external_id)) between 1 and 300),
  check (last_seen_at >= first_seen_at),
  check (recovered_at is null or recovered_at >= first_seen_at),
  check (checkout_url is null or pg_catalog.length(checkout_url) <= 8192),
  check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create index checkout_recovery_attempts_project_status_idx
  on public.checkout_recovery_attempts (project_id, status, last_seen_at desc);
create index checkout_recovery_attempts_contact_idx
  on public.checkout_recovery_attempts (contact_id, last_seen_at desc)
  where contact_id is not null;
create index checkout_recovery_attempts_campaign_idx
  on public.checkout_recovery_attempts (utm_campaign_id, last_seen_at desc)
  where utm_campaign_id is not null;

create trigger checkout_recovery_attempts_set_updated_at
before update on public.checkout_recovery_attempts
for each row execute function public.set_updated_at();

create trigger checkout_recovery_attempts_require_active_project
before insert or update or delete on public.checkout_recovery_attempts
for each row execute function public.enforce_active_project_reference();

alter table public.checkout_recovery_attempts enable row level security;

create policy checkout_recovery_attempts_admin_read
on public.checkout_recovery_attempts for select to authenticated
using (public.is_org_admin(organization_id));

revoke all on table public.checkout_recovery_attempts
from public, anon, authenticated;
grant select on table public.checkout_recovery_attempts to authenticated;
grant all on table public.checkout_recovery_attempts to service_role;

create function public.process_hubla_project_event(
  p_connection_id uuid,
  p_idempotency_key text,
  p_event_type text,
  p_event_at timestamptz,
  p_entity_id text,
  p_gross_amount numeric,
  p_currency text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw_event_id uuid;
  v_organization_id uuid;
  v_project_id uuid;
  v_product_id uuid;
  v_contact jsonb := coalesce(p_payload -> 'contact', '{}'::jsonb);
  v_attribution jsonb := coalesce(p_payload -> 'attribution', '{}'::jsonb);
  v_utm jsonb;
  v_identifiers jsonb;
  v_name text;
  v_email text;
  v_phone text;
  v_normalized_phone text;
  v_email_contact_id uuid;
  v_phone_contact_id uuid;
  v_contact_id uuid;
  v_campaign_id uuid;
  v_touchpoint_id uuid;
  v_source text;
  v_medium text;
  v_campaign text;
  v_term text;
  v_content text;
  v_landing_url text;
  v_offer_external_id text;
  v_status text;
  v_attempt_status text;
  v_external_kind text;
  v_sales_event_id uuid;
  v_sales_net_amount numeric;
begin
  select raw.id, raw.organization_id, raw.project_id, raw.product_id
  into v_raw_event_id, v_organization_id, v_project_id, v_product_id
  from public.hubla_webhook_events raw
  where raw.connection_id = p_connection_id
    and raw.idempotency_key = pg_catalog.btrim(p_idempotency_key)
  for update;

  if v_raw_event_id is null then
    return;
  end if;

  v_status := nullif(pg_catalog.lower(pg_catalog.btrim(p_payload ->> 'status')), '');
  v_offer_external_id := nullif(
    pg_catalog.btrim(p_payload #>> '{offer,id}'),
    ''
  );
  v_utm := case
    when pg_catalog.jsonb_typeof(v_attribution -> 'utm') = 'object'
      then v_attribution -> 'utm'
    else '{}'::jsonb
  end;
  v_identifiers := case
    when pg_catalog.jsonb_typeof(v_attribution -> 'identifiers') = 'object'
      then v_attribution -> 'identifiers'
    else '{}'::jsonb
  end;

  update public.hubla_webhook_events raw
  set payload = raw.payload || pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'status', v_status,
      'offer_external_id', v_offer_external_id,
      'attribution', case
        when v_attribution <> '{}'::jsonb then v_attribution - 'identifiers'
        else null
      end
    )
  )
  where raw.id = v_raw_event_id;

  if v_project_id is null
    or pg_catalog.jsonb_typeof(v_contact) <> 'object'
    or pg_catalog.jsonb_typeof(v_attribution) <> 'object' then
    return;
  end if;

  v_name := nullif(pg_catalog.btrim(v_contact ->> 'name'), '');
  v_email := nullif(pg_catalog.lower(pg_catalog.btrim(v_contact ->> 'email')), '');
  v_phone := nullif(pg_catalog.btrim(v_contact ->> 'phone'), '');
  if v_email is not null and (
    pg_catalog.length(v_email) > 254 or pg_catalog.strpos(v_email, '@') <= 1
  ) then
    v_email := null;
  end if;
  v_normalized_phone := nullif(
    pg_catalog.regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'),
    ''
  );
  if v_normalized_phone is not null
    and pg_catalog.length(v_normalized_phone) not between 8 and 15 then
    v_phone := null;
    v_normalized_phone := null;
  end if;

  if v_name is not null or v_email is not null or v_phone is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_project_id::text || ':' || coalesce(v_email, '') || ':' ||
        coalesce(v_normalized_phone, ''),
        0
      )
    );

    if v_email is not null then
      select contact.id into v_email_contact_id
      from public.contacts contact
      where contact.project_id = v_project_id
        and contact.normalized_email = v_email
        and contact.archived_at is null
      for update;
    end if;
    if v_normalized_phone is not null then
      select contact.id into v_phone_contact_id
      from public.contacts contact
      where contact.project_id = v_project_id
        and contact.normalized_phone = v_normalized_phone
        and contact.archived_at is null
      for update;
    end if;

    if not (
      v_email_contact_id is not null
      and v_phone_contact_id is not null
      and v_email_contact_id <> v_phone_contact_id
    ) then
      v_contact_id := coalesce(v_email_contact_id, v_phone_contact_id);
      if v_contact_id is null then
        insert into public.contacts (
          organization_id, project_id, name, email, phone, source,
          metadata, first_seen_at, last_seen_at
        ) values (
          v_organization_id, v_project_id, v_name, v_email, v_phone,
          'hubla',
          pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'hubla_contact_id', nullif(v_contact ->> 'external_id', '')
          )),
          p_event_at, p_event_at
        ) returning id into v_contact_id;
      else
        update public.contacts contact
        set name = coalesce(contact.name, v_name),
            email = coalesce(contact.email, v_email),
            phone = coalesce(contact.phone, v_phone),
            metadata = contact.metadata || pg_catalog.jsonb_strip_nulls(
              pg_catalog.jsonb_build_object(
                'hubla_contact_id', nullif(v_contact ->> 'external_id', '')
              )
            ),
            first_seen_at = least(contact.first_seen_at, p_event_at),
            last_seen_at = greatest(contact.last_seen_at, p_event_at)
        where contact.id = v_contact_id;
      end if;
    end if;
  end if;

  v_source := nullif(pg_catalog.lower(pg_catalog.btrim(v_utm ->> 'source')), '');
  v_medium := nullif(pg_catalog.lower(pg_catalog.btrim(v_utm ->> 'medium')), '');
  v_campaign := nullif(pg_catalog.lower(pg_catalog.btrim(v_utm ->> 'campaign')), '');
  v_term := nullif(pg_catalog.btrim(v_utm ->> 'term'), '');
  v_content := nullif(pg_catalog.btrim(v_utm ->> 'content'), '');
  v_landing_url := nullif(pg_catalog.btrim(v_attribution ->> 'landing_url'), '');

  if v_contact_id is not null
    and (v_source is not null or v_medium is not null or v_campaign is not null) then
    insert into public.utm_campaigns (
      organization_id, project_id, utm_source, utm_medium, utm_campaign,
      first_seen_at, last_seen_at
    ) values (
      v_organization_id, v_project_id, v_source, v_medium, v_campaign,
      p_event_at, p_event_at
    )
    on conflict (project_id, utm_source, utm_medium, utm_campaign) do update
    set first_seen_at = least(public.utm_campaigns.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(public.utm_campaigns.last_seen_at, excluded.last_seen_at)
    returning id into v_campaign_id;
  end if;

  if v_contact_id is not null then
    insert into public.contact_touchpoints (
      organization_id, project_id, contact_id, utm_campaign_id,
      touchpoint_type, occurred_at, utm_term, utm_content,
      landing_url, external_id, metadata
    ) values (
      v_organization_id, v_project_id, v_contact_id, v_campaign_id,
      case when p_event_type = 'lead.abandoned_checkout'
        then 'checkout_abandoned' else 'hubla_event' end,
      p_event_at, v_term, v_content, v_landing_url,
      'hubla:' || p_connection_id::text || ':' || pg_catalog.btrim(p_idempotency_key),
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'provider', 'hubla',
        'event_type', p_event_type,
        'entity_id', p_entity_id,
        'offer_external_id', v_offer_external_id,
        'utm_id', nullif(v_utm ->> 'id', ''),
        'hubla_session_id', nullif(v_identifiers ->> 'hb_id', ''),
        'fbp', nullif(v_identifiers ->> 'fbp', ''),
        'fbclid', nullif(v_identifiers ->> 'fbclid', ''),
        'src', nullif(v_identifiers ->> 'src', '')
      ))
    )
    on conflict (project_id, external_id) where external_id is not null
    do update set
      contact_id = excluded.contact_id,
      utm_campaign_id = excluded.utm_campaign_id,
      occurred_at = excluded.occurred_at,
      utm_term = excluded.utm_term,
      utm_content = excluded.utm_content,
      landing_url = excluded.landing_url,
      metadata = excluded.metadata
    returning id into v_touchpoint_id;
  end if;

  v_external_kind := case
    when p_event_type = 'lead.abandoned_checkout' then 'lead'
    when p_event_type like 'invoice.%' then 'invoice'
    else null
  end;
  v_attempt_status := case
    when p_event_type = 'lead.abandoned_checkout' then 'abandoned'
    when p_event_type = 'invoice.payment_succeeded' then 'recovered'
    when p_event_type = 'invoice.payment_failed' then 'failed'
    when p_event_type = 'invoice.expired' then 'expired'
    when p_event_type = 'invoice.created' then 'pending'
    when p_event_type = 'invoice.status_updated' and v_status in ('paid', 'approved')
      then 'recovered'
    when p_event_type = 'invoice.status_updated' and v_status in ('expired', 'canceled', 'cancelled')
      then 'expired'
    when p_event_type = 'invoice.status_updated' then 'pending'
    else null
  end;

  if v_external_kind is not null
    and v_attempt_status is not null
    and nullif(pg_catalog.btrim(p_entity_id), '') is not null then
    insert into public.checkout_recovery_attempts (
      organization_id, project_id, connection_id, product_id, contact_id,
      latest_webhook_event_id, external_kind, external_id, status,
      amount, currency, offer_external_id, checkout_url, utm_campaign_id,
      utm_term, utm_content, first_seen_at, last_seen_at, recovered_at,
      metadata
    ) values (
      v_organization_id, v_project_id, p_connection_id, v_product_id, v_contact_id,
      v_raw_event_id, v_external_kind, pg_catalog.btrim(p_entity_id),
      v_attempt_status, coalesce(p_gross_amount, 0),
      coalesce(nullif(pg_catalog.upper(pg_catalog.btrim(p_currency)), ''), 'BRL'),
      v_offer_external_id, v_landing_url, v_campaign_id, v_term, v_content,
      p_event_at, p_event_at,
      case when v_attempt_status = 'recovered' then p_event_at else null end,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'hubla_status', v_status,
        'utm_id', nullif(v_utm ->> 'id', ''),
        'src', nullif(v_identifiers ->> 'src', '')
      ))
    )
    on conflict (connection_id, external_kind, external_id) do update
    set product_id = coalesce(excluded.product_id, public.checkout_recovery_attempts.product_id),
        contact_id = coalesce(excluded.contact_id, public.checkout_recovery_attempts.contact_id),
        latest_webhook_event_id = excluded.latest_webhook_event_id,
        status = case
          when public.checkout_recovery_attempts.status = 'recovered'
            and excluded.status <> 'recovered'
            then public.checkout_recovery_attempts.status
          else excluded.status
        end,
        amount = excluded.amount,
        currency = excluded.currency,
        offer_external_id = coalesce(excluded.offer_external_id, public.checkout_recovery_attempts.offer_external_id),
        checkout_url = coalesce(excluded.checkout_url, public.checkout_recovery_attempts.checkout_url),
        utm_campaign_id = coalesce(excluded.utm_campaign_id, public.checkout_recovery_attempts.utm_campaign_id),
        utm_term = coalesce(excluded.utm_term, public.checkout_recovery_attempts.utm_term),
        utm_content = coalesce(excluded.utm_content, public.checkout_recovery_attempts.utm_content),
        first_seen_at = least(public.checkout_recovery_attempts.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(public.checkout_recovery_attempts.last_seen_at, excluded.last_seen_at),
        recovered_at = coalesce(public.checkout_recovery_attempts.recovered_at, excluded.recovered_at),
        metadata = public.checkout_recovery_attempts.metadata || excluded.metadata;
  end if;

  if v_attempt_status = 'recovered' and v_contact_id is not null then
    update public.checkout_recovery_attempts attempt
    set status = 'recovered',
        recovered_at = coalesce(attempt.recovered_at, p_event_at),
        last_seen_at = greatest(attempt.last_seen_at, p_event_at),
        latest_webhook_event_id = v_raw_event_id
    where attempt.project_id = v_project_id
      and attempt.contact_id = v_contact_id
      and (v_product_id is null or attempt.product_id = v_product_id)
      and attempt.status in ('abandoned', 'pending', 'failed')
      and attempt.first_seen_at <= p_event_at;
  end if;

  select sale.id, sale.net_amount into v_sales_event_id, v_sales_net_amount
  from public.sales_events sale
  where sale.connection_id = p_connection_id
    and (
      sale.external_event_id = pg_catalog.btrim(p_idempotency_key)
      or (
        p_entity_id is not null
        and sale.external_transaction_id = pg_catalog.btrim(p_entity_id)
      )
    )
  order by (sale.external_event_id = pg_catalog.btrim(p_idempotency_key)) desc
  limit 1;

  if v_sales_event_id is not null and v_contact_id is not null then
    update public.sales_events sale
    set contact_id = coalesce(sale.contact_id, v_contact_id),
        payload = sale.payload || pg_catalog.jsonb_strip_nulls(
          pg_catalog.jsonb_build_object(
            'attribution', case
              when v_attribution <> '{}'::jsonb then v_attribution - 'identifiers'
              else null
            end,
            'offer_external_id', v_offer_external_id
          )
        )
    where sale.id = v_sales_event_id;

    if p_event_type = 'invoice.payment_succeeded' then
      select touch.id into v_touchpoint_id
      from public.contact_touchpoints touch
      where touch.project_id = v_project_id
        and touch.contact_id = v_contact_id
        and touch.occurred_at <= p_event_at
      order by (touch.utm_campaign_id is not null) desc, touch.occurred_at desc
      limit 1;

      insert into public.sales_contact_attributions (
        organization_id, project_id, sales_event_id, contact_id,
        touchpoint_id, attribution_model, attributed_amount,
        attributed_at, metadata
      ) values (
        v_organization_id, v_project_id, v_sales_event_id, v_contact_id,
        v_touchpoint_id, 'last_touch', coalesce(v_sales_net_amount, p_gross_amount, 0),
        p_event_at, '{"provider":"hubla"}'::jsonb
      )
      on conflict (sales_event_id, attribution_model) do update
      set contact_id = excluded.contact_id,
          touchpoint_id = excluded.touchpoint_id,
          attributed_amount = excluded.attributed_amount,
          attributed_at = excluded.attributed_at,
          metadata = excluded.metadata;
    end if;
  end if;
end;
$$;

revoke all on function public.process_hubla_project_event(
  uuid, text, text, timestamptz, text, numeric, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.ingest_hubla_webhook(
  p_connection_id uuid,
  p_idempotency_key text,
  p_event_type text,
  p_contract_version text,
  p_event_at timestamptz,
  p_entity_id text,
  p_entity_version bigint,
  p_product_external_id text,
  p_product_name text,
  p_gross_amount numeric,
  p_net_amount numeric,
  p_currency text,
  p_sandbox boolean,
  p_payload jsonb
)
returns table(duplicate boolean, mapped boolean, normalized boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_constraint_name text;
  v_duplicate boolean;
  v_mapped boolean;
  v_normalized boolean;
begin
  select result.duplicate, result.mapped, result.normalized
  into v_duplicate, v_mapped, v_normalized
  from public.ingest_hubla_webhook_transactional(
    p_connection_id, p_idempotency_key, p_event_type, p_contract_version,
    p_event_at, p_entity_id, p_entity_version, p_product_external_id,
    p_product_name, p_gross_amount, p_net_amount, p_currency, p_sandbox, p_payload
  ) result;

  if not coalesce(v_duplicate, false) and not coalesce(p_sandbox, false) then
    perform public.process_hubla_project_event(
      p_connection_id, p_idempotency_key, p_event_type, p_event_at,
      p_entity_id, p_gross_amount, p_currency, p_payload
    );
  end if;

  return query select v_duplicate, v_mapped, v_normalized;
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = CONSTRAINT_NAME;
    if v_constraint_name <> 'sales_events_approved_transaction_unique' then
      raise;
    end if;
    return query
    select true, event.project_id is not null, false
    from public.sales_events event
    where event.connection_id = p_connection_id
      and event.external_transaction_id = pg_catalog.btrim(p_entity_id)
      and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED')
    order by event.event_at desc
    limit 1;
end;
$$;

revoke all on function public.ingest_hubla_webhook(
  uuid, text, text, text, timestamptz, text, bigint, text, text,
  numeric, numeric, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_hubla_webhook(
  uuid, text, text, text, timestamptz, text, bigint, text, text,
  numeric, numeric, text, boolean, jsonb
) to service_role;
