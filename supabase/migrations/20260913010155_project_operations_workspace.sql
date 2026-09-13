-- The Google schema remains dynamic; this stores only its linked spreadsheet ID.
alter table public.google_forms add column linked_sheet_id text;
alter table public.google_forms
  add column last_sync_attempt_at timestamptz,
  add column response_page_token text,
  add column response_page_since timestamptz,
  add column response_pending_cursor_at timestamptz;
create index google_forms_sync_queue_idx on public.google_forms (last_sync_attempt_at nulls first, id) where archived_at is null;

create index sales_events_project_period_idx on public.sales_events (project_id, event_at desc, id)
where project_id is not null;
create index checkout_recovery_project_period_idx on public.checkout_recovery_attempts (project_id, last_seen_at desc, id);

-- Preserve attribution when a later purchase event omits fields sent at approval.
create function public.enrich_hotmart_sale_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_contact jsonb;
  v_email text;
  v_phone text;
  v_name text;
  v_email_id uuid;
  v_phone_id uuid;
  v_contact_id uuid;
  v_key text;
begin
  if not exists (select 1 from public.integration_connections c where c.id = new.connection_id and c.provider = 'hotmart') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.currency = new.currency and (new.payload #> '{financial,payout}' is null or new.payload #> '{financial,payout}' = 'null'::jsonb)
      and old.payload #> '{financial,payout}' is not null and old.payload #> '{financial,payout}' <> 'null'::jsonb then
      new.net_amount := old.net_amount;
      new.payload := pg_catalog.jsonb_set(new.payload, '{net_amount_source}', coalesce(old.payload -> 'net_amount_source', '"producer_commission"'::jsonb));
      new.payload := pg_catalog.jsonb_set(new.payload, '{financial}',
        coalesce(new.payload -> 'financial', '{}'::jsonb) || pg_catalog.jsonb_build_object('payout_source', old.payload #>> '{financial,payout_source}'));
    end if;
    foreach v_key in array array['contact', 'attribution', 'financial', 'payment', 'offer'] loop
      if v_key = 'financial' and old.currency <> new.currency then continue; end if;
      if old.payload ? v_key then
        new.payload := pg_catalog.jsonb_set(new.payload, array[v_key],
          old.payload -> v_key || coalesce((select pg_catalog.jsonb_object_agg(k, v)
            from pg_catalog.jsonb_each(coalesce(new.payload -> v_key, '{}'::jsonb)) x(k, v)
            where v not in ('null'::jsonb, '""'::jsonb, '{}'::jsonb)), '{}'::jsonb));
      end if;
    end loop;
    -- An empty normalized UTM object must not erase the previous dimensions.
    if old.payload #> '{attribution,utm}' is not null then
      new.payload := pg_catalog.jsonb_set(new.payload, '{attribution,utm}',
        old.payload #> '{attribution,utm}' || coalesce((select pg_catalog.jsonb_object_agg(k, v)
          from pg_catalog.jsonb_each(coalesce(new.payload #> '{attribution,utm}', '{}'::jsonb)) x(k, v)
          where v not in ('null'::jsonb, '""'::jsonb)), '{}'::jsonb));
    end if;
  end if;
  if new.project_id is null or new.contact_id is not null then return new; end if;
  v_contact := coalesce(new.payload -> 'contact', '{}'::jsonb);
  v_email := nullif(pg_catalog.lower(pg_catalog.btrim(v_contact ->> 'email')), '');
  v_phone := nullif(pg_catalog.regexp_replace(coalesce(v_contact ->> 'phone', ''), '[^0-9]', '', 'g'), '');
  v_name := nullif(pg_catalog.btrim(v_contact ->> 'name'), '');
  if v_email is not null and (pg_catalog.length(v_email) > 254 or pg_catalog.strpos(v_email, '@') <= 1) then v_email := null; end if;
  if v_phone is not null and pg_catalog.length(v_phone) not between 8 and 15 then v_phone := null; end if;
  -- A name alone is insufficient to identify a buyer across transactions.
  if v_email is null and v_phone is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sale-contact:' || new.project_id::text, 0));
  select id into v_email_id from public.contacts where project_id = new.project_id and normalized_email = v_email and archived_at is null;
  select id into v_phone_id from public.contacts where project_id = new.project_id and normalized_phone = v_phone and archived_at is null;
  if v_email_id is not null and v_phone_id is not null and v_email_id <> v_phone_id then
    new.payload := new.payload || '{"contact_match_status":"conflict"}'::jsonb;
    return new;
  end if;
  v_contact_id := coalesce(v_email_id, v_phone_id);
  if v_contact_id is null then
    insert into public.contacts (organization_id, project_id, name, email, phone, source, first_seen_at, last_seen_at)
    values (new.organization_id, new.project_id, v_name, v_email, v_phone, 'hotmart', new.event_at, new.event_at)
    returning id into v_contact_id;
  else
    update public.contacts set name = coalesce(name, v_name), email = coalesce(email, v_email), phone = coalesce(phone, v_phone),
      first_seen_at = least(first_seen_at, new.event_at), last_seen_at = greatest(last_seen_at, new.event_at)
    where id = v_contact_id;
  end if;
  new.contact_id := v_contact_id;
  return new;
end;
$$;
revoke all on function public.enrich_hotmart_sale_contact() from public, anon, authenticated, service_role;
create trigger sales_events_enrich_hotmart before insert or update on public.sales_events
for each row execute function public.enrich_hotmart_sale_contact();

-- A scoped, stable event identifier keeps approvals and completions from duplicating touchpoints.
create function public.attribute_hotmart_sale()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_utm jsonb := coalesce(new.payload #> '{attribution,utm}', '{}'::jsonb);
  v_source text := nullif(v_utm ->> 'source', '');
  v_medium text := nullif(v_utm ->> 'medium', '');
  v_campaign text := nullif(v_utm ->> 'campaign', '');
  v_campaign_id uuid;
  v_touch_id uuid;
begin
  if new.project_id is null or new.contact_id is null or not exists
    (select 1 from public.integration_connections where id = new.connection_id and provider = 'hotmart') then return new; end if;
  if new.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED') then
    if v_source is not null or v_medium is not null or v_campaign is not null then
      insert into public.utm_campaigns (organization_id, project_id, utm_source, utm_medium, utm_campaign, first_seen_at, last_seen_at)
      values (new.organization_id, new.project_id, v_source, v_medium, v_campaign, new.event_at, new.event_at)
      on conflict (project_id, utm_source, utm_medium, utm_campaign) do update
      set first_seen_at = least(public.utm_campaigns.first_seen_at, excluded.first_seen_at),
          last_seen_at = greatest(public.utm_campaigns.last_seen_at, excluded.last_seen_at)
      returning id into v_campaign_id;
    end if;
    insert into public.contact_touchpoints (organization_id, project_id, contact_id, utm_campaign_id, touchpoint_type, occurred_at, utm_term, utm_content, landing_url, external_id, metadata)
    values (new.organization_id, new.project_id, new.contact_id, v_campaign_id, 'purchase', new.event_at,
      nullif(v_utm ->> 'term', ''), nullif(v_utm ->> 'content', ''), new.payload #>> '{attribution,landing_url}',
      'hotmart-sale:' || new.id::text, pg_catalog.jsonb_build_object('provider', 'hotmart', 'sales_event_id', new.id))
    on conflict (project_id, external_id) where external_id is not null do update
    set utm_campaign_id = coalesce(excluded.utm_campaign_id, public.contact_touchpoints.utm_campaign_id),
      utm_term = coalesce(excluded.utm_term, public.contact_touchpoints.utm_term),
      utm_content = coalesce(excluded.utm_content, public.contact_touchpoints.utm_content),
      landing_url = coalesce(excluded.landing_url, public.contact_touchpoints.landing_url);
  end if;
  select id into v_touch_id from public.contact_touchpoints where project_id = new.project_id
    and contact_id = new.contact_id and occurred_at <= new.event_at
    order by (utm_campaign_id is not null) desc, occurred_at desc, id limit 1;
  insert into public.sales_contact_attributions (organization_id, project_id, sales_event_id, contact_id, touchpoint_id, attributed_amount, attributed_at, metadata)
  values (new.organization_id, new.project_id, new.id, new.contact_id, v_touch_id, new.net_amount, new.event_at, '{"provider":"hotmart"}'::jsonb)
  on conflict (sales_event_id, attribution_model) do update
  set touchpoint_id = excluded.touchpoint_id, attributed_amount = excluded.attributed_amount;
  return new;
end;
$$;
revoke all on function public.attribute_hotmart_sale() from public, anon, authenticated, service_role;
create trigger sales_events_attribute_hotmart after insert or update on public.sales_events
for each row execute function public.attribute_hotmart_sale();

-- The scheduler reads a dedicated job token and destination from Vault.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create function public.dispatch_google_forms_sync()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_token text; v_request_id bigint;
begin
  if not exists (select 1 from public.google_forms f join public.projects p on p.id = f.project_id
    join public.integration_connections c on c.id = f.connection_id
    where f.archived_at is null and p.deleted_at is null and c.revoked_at is null) then return null; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'genesis_google_forms_job_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'genesis_google_forms_job_token';
  if v_url is null or v_token is null then return null; end if;
  select net.http_post(url := v_url, headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    body := '{}'::jsonb, timeout_milliseconds := 300000) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function public.dispatch_google_forms_sync() from public, anon, authenticated, service_role;
select cron.schedule('genesis-google-forms-sync', '* * * * *', 'select public.dispatch_google_forms_sync();');

-- Response replays retain the original question snapshots.
create or replace function public.ingest_google_form_response(
  p_google_form_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.google_forms%rowtype;
  v_external_response_id text;
  v_created_at timestamptz;
  v_submitted_at timestamptz;
  v_answers jsonb;
  v_identity jsonb;
  v_utm jsonb;
  v_name text;
  v_email text;
  v_phone text;
  v_normalized_email text;
  v_normalized_phone text;
  v_email_contact_id uuid;
  v_phone_contact_id uuid;
  v_contact_id uuid;
  v_response_id uuid;
  v_existing_submitted_at timestamptz;
  v_match_status text := 'unresolved';
  v_match_method text;
  v_match_error text;
  v_campaign_id uuid;
  v_source text;
  v_medium text;
  v_campaign text;
  v_term text;
  v_content text;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_response, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid form response' using errcode = '22023';
  end if;

  select form.* into v_form
  from public.google_forms form
  join public.projects project on project.id = form.project_id
  where form.id = p_google_form_id
    and form.archived_at is null
    and project.deleted_at is null
  for update of form;
  if not found or v_form.schema_version < 1 then
    raise exception 'active synchronized form not found' using errcode = 'P0002';
  end if;

  v_external_response_id := pg_catalog.btrim(coalesce(p_response ->> 'externalResponseId', ''));
  v_created_at := (p_response ->> 'createdAt')::timestamptz;
  v_submitted_at := (p_response ->> 'submittedAt')::timestamptz;
  v_answers := coalesce(p_response -> 'answers', '[]'::jsonb);
  v_identity := coalesce(p_response -> 'identity', '{}'::jsonb);
  v_utm := coalesce(p_response -> 'utm', '{}'::jsonb);

  if v_external_response_id = ''
    or v_created_at is null
    or v_submitted_at is null
    or v_submitted_at < v_created_at
    or pg_catalog.jsonb_typeof(v_answers) <> 'array'
    or pg_catalog.jsonb_typeof(v_identity) <> 'object'
    or pg_catalog.jsonb_typeof(v_utm) <> 'object' then
    raise exception 'invalid form response' using errcode = '22023';
  end if;

  select response.id, response.last_submitted_at
  into v_response_id, v_existing_submitted_at
  from public.google_form_responses response
  where response.google_form_id = p_google_form_id
    and response.external_response_id = v_external_response_id
  for update;

  if v_existing_submitted_at is not null
    and v_existing_submitted_at >= v_submitted_at then
    return pg_catalog.jsonb_build_object(
      'id', v_response_id,
      'duplicate', true,
      'status', 'unchanged_or_older_version'
    );
  end if;

  v_name := nullif(pg_catalog.btrim(v_identity ->> 'name'), '');
  v_email := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(
    v_identity ->> 'email', p_response ->> 'respondentEmail'
  ))), '');
  v_phone := nullif(pg_catalog.btrim(v_identity ->> 'phone'), '');
  v_normalized_email := v_email;
  v_normalized_phone := nullif(
    pg_catalog.regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), ''
  );

  if v_normalized_phone is not null
    and pg_catalog.length(v_normalized_phone) not between 8 and 15 then
    v_phone := null;
    v_normalized_phone := null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_form.project_id::text || ':' || coalesce(v_normalized_email, '') || ':' ||
      coalesce(v_normalized_phone, ''),
      0
    )
  );

  if v_normalized_email is not null then
    select contact.id into v_email_contact_id
    from public.contacts contact
    where contact.project_id = v_form.project_id
      and contact.normalized_email = v_normalized_email
      and contact.archived_at is null
    for update;
  end if;
  if v_normalized_phone is not null then
    select contact.id into v_phone_contact_id
    from public.contacts contact
    where contact.project_id = v_form.project_id
      and contact.normalized_phone = v_normalized_phone
      and contact.archived_at is null
    for update;
  end if;

  if v_email_contact_id is not null and v_phone_contact_id is not null
    and v_email_contact_id <> v_phone_contact_id then
    v_match_status := 'conflict';
    v_match_error := 'email and phone belong to different contacts';
  else
    v_contact_id := coalesce(v_email_contact_id, v_phone_contact_id);
    if v_contact_id is null and (v_name is not null or v_email is not null or v_phone is not null) then
      insert into public.contacts (
        organization_id, project_id, name, email, phone, source,
        first_seen_at, last_seen_at
      ) values (
        v_form.organization_id, v_form.project_id, v_name, v_email, v_phone,
        'google_forms', v_created_at, v_submitted_at
      ) returning id into v_contact_id;
    elsif v_contact_id is not null then
      update public.contacts contact
      set name = coalesce(contact.name, v_name),
          email = coalesce(contact.email, v_email),
          phone = coalesce(contact.phone, v_phone),
          last_seen_at = greatest(contact.last_seen_at, v_submitted_at)
      where contact.id = v_contact_id;
    end if;

    if v_contact_id is not null then
      v_match_status := 'matched';
      v_match_method := case
        when v_email_contact_id is not null and v_phone_contact_id is not null
          then 'email_and_phone'
        when v_email_contact_id is not null then 'email'
        when v_phone_contact_id is not null then 'phone'
        when v_email is not null and v_phone is not null then 'email_and_phone'
        when v_email is not null then 'email'
        else 'phone'
      end;
    end if;
  end if;

  insert into public.google_form_responses (
    organization_id, project_id, google_form_id, contact_id,
    external_response_id, schema_version, response_created_at,
    last_submitted_at, respondent_email, total_score, match_status,
    match_method, match_error, metadata, synced_at
  ) values (
    v_form.organization_id, v_form.project_id, p_google_form_id, v_contact_id,
    v_external_response_id, v_form.schema_version, v_created_at,
    v_submitted_at, nullif(p_response ->> 'respondentEmail', ''),
    nullif(p_response ->> 'totalScore', '')::numeric, v_match_status,
    v_match_method, v_match_error,
    pg_catalog.jsonb_build_object('source', 'google_forms'), now()
  )
  on conflict (google_form_id, external_response_id) do update
  set contact_id = excluded.contact_id,
      schema_version = excluded.schema_version,
      last_submitted_at = excluded.last_submitted_at,
      respondent_email = excluded.respondent_email,
      total_score = excluded.total_score,
      match_status = excluded.match_status,
      match_method = excluded.match_method,
      match_error = excluded.match_error,
      synced_at = now()
  returning id into v_response_id;

  delete from public.google_form_answers answer
  where answer.google_form_response_id = v_response_id;

  -- Keep answers even when their questions were deleted before the first import.
  insert into public.google_form_questions (organization_id, project_id, google_form_id, external_question_id,
    title, question_type, position, first_seen_version, last_seen_version, archived_at)
  select v_form.organization_id, v_form.project_id, p_google_form_id, answer ->> 'questionId',
    'Pergunta removida (' || (answer ->> 'questionId') || ')', 'unknown',
    coalesce((select max(position) + 1 from public.google_form_questions where google_form_id = p_google_form_id), 0) + ordinality::integer,
    v_form.schema_version, v_form.schema_version, now()
  from pg_catalog.jsonb_array_elements(v_answers) with ordinality a(answer, ordinality)
  where nullif(answer ->> 'questionId', '') is not null
  on conflict (google_form_id, external_question_id) do nothing;

  insert into public.google_form_answers (
    organization_id, project_id, google_form_id, google_form_response_id,
    google_form_question_id, value, grade, question_title_snapshot,
    question_type_snapshot
  )
  select
    v_form.organization_id, v_form.project_id, p_google_form_id, v_response_id,
    question.id, coalesce(answer -> 'values', '[]'::jsonb),
    case when pg_catalog.jsonb_typeof(answer -> 'grade') = 'object'
      then answer -> 'grade' else null end,
    question.title, question.question_type
  from pg_catalog.jsonb_array_elements(v_answers) answer
  join public.google_form_questions question
    on question.google_form_id = p_google_form_id
   and question.external_question_id = answer ->> 'questionId'
  where pg_catalog.jsonb_typeof(coalesce(answer -> 'values', '[]'::jsonb))
    in ('array', 'object');

  v_source := nullif(pg_catalog.lower(pg_catalog.btrim(v_utm ->> 'source')), '');
  v_medium := nullif(pg_catalog.lower(pg_catalog.btrim(v_utm ->> 'medium')), '');
  v_campaign := nullif(pg_catalog.lower(pg_catalog.btrim(v_utm ->> 'campaign')), '');
  v_term := nullif(pg_catalog.btrim(v_utm ->> 'term'), '');
  v_content := nullif(pg_catalog.btrim(v_utm ->> 'content'), '');

  if v_contact_id is not null
    and (v_source is not null or v_medium is not null or v_campaign is not null) then
    insert into public.utm_campaigns (
      organization_id, project_id, utm_source, utm_medium, utm_campaign,
      first_seen_at, last_seen_at
    ) values (
      v_form.organization_id, v_form.project_id, v_source, v_medium, v_campaign,
      v_submitted_at, v_submitted_at
    )
    on conflict (project_id, utm_source, utm_medium, utm_campaign) do update
    set first_seen_at = least(public.utm_campaigns.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(public.utm_campaigns.last_seen_at, excluded.last_seen_at)
    returning id into v_campaign_id;
  end if;

  if v_contact_id is not null then
    insert into public.contact_touchpoints (
      organization_id, project_id, contact_id, utm_campaign_id,
      google_form_response_id, touchpoint_type, occurred_at,
      utm_term, utm_content, external_id, metadata
    ) values (
      v_form.organization_id, v_form.project_id, v_contact_id, v_campaign_id,
      v_response_id, 'form_response', v_submitted_at,
      v_term, v_content, 'google-form-response:' || v_external_response_id,
      pg_catalog.jsonb_build_object('google_form_id', p_google_form_id)
    )
    on conflict (google_form_response_id) where google_form_response_id is not null
    do update set
      contact_id = excluded.contact_id,
      utm_campaign_id = excluded.utm_campaign_id,
      occurred_at = excluded.occurred_at,
      utm_term = excluded.utm_term,
      utm_content = excluded.utm_content;

    update public.form_audience_members member
    set responded_at = coalesce(member.responded_at, v_submitted_at)
    from public.form_audiences audience
    where audience.id = member.audience_id
      and audience.google_form_id = p_google_form_id
      and member.contact_id = v_contact_id;
  end if;

  update public.google_forms form
  set last_response_at = greatest(
        coalesce(form.last_response_at, v_submitted_at), v_submitted_at
      ),
      last_error = null
  where form.id = p_google_form_id;

  return pg_catalog.jsonb_build_object(
    'id', v_response_id,
    'contactId', v_contact_id,
    'matchStatus', v_match_status,
    'matchMethod', v_match_method,
    'duplicate', v_existing_submitted_at is not null
  );
end;
$$;

revoke all on function public.ingest_google_form_response(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.ingest_google_form_response(uuid, jsonb)
to service_role;


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
    -- Persist the normalized fields needed by the project tables, including unmapped sales.
    update public.sales_events sale
    set payload = sale.payload || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'financial', p_payload -> 'financial', 'contact', p_payload -> 'contact',
      'attribution', (p_payload -> 'attribution') - 'identifiers', 'offer', p_payload -> 'offer', 'payment', p_payload -> 'payment',
      'product_name', p_product_name))
    where sale.connection_id = p_connection_id and sale.external_event_id = pg_catalog.btrim(p_idempotency_key);
    update public.hubla_webhook_events raw
    set payload = raw.payload || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'financial', p_payload -> 'financial', 'contact', p_payload -> 'contact', 'offer', p_payload -> 'offer'))
    where raw.connection_id = p_connection_id and raw.idempotency_key = pg_catalog.btrim(p_idempotency_key);
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

create or replace function public.ingest_hotmart_sale_unchecked(
  p_connection_id uuid,
  p_external_event_id text,
  p_external_transaction_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_product_external_id text,
  p_product_name text,
  p_gross_amount numeric,
  p_net_amount numeric,
  p_currency text,
  p_payload jsonb default '{}'::jsonb
)
returns table (event_id uuid, duplicate boolean, mapped boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_product_id uuid;
  v_product_name text;
  v_project_id uuid;
  v_stage_id uuid;
  v_stage_name text;
  v_stage_type public.funnel_stage_type;
  v_mapping_id uuid;
  v_event_id uuid;
  v_event_by_external_id uuid;
  v_event_by_transaction_id uuid;
  v_result_project_id uuid;
  v_existing_event_type text;
  v_payload jsonb;
  v_external_event_id text;
  v_external_transaction_id text;
  v_product_external_id text;
begin
  select connection.organization_id into v_organization_id
  from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.provider = 'hotmart'
    and connection.revoked_at is null
  for update;

  if v_organization_id is null then
    raise exception 'active Hotmart connection not found';
  end if;
  if p_event_type not in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED') then
    raise exception 'unsupported Hotmart event';
  end if;
  if p_external_event_id is null
    or p_external_transaction_id is null
    or p_product_external_id is null
    or pg_catalog.length(pg_catalog.btrim(p_external_event_id)) = 0
    or pg_catalog.length(pg_catalog.btrim(p_external_transaction_id)) = 0
    or pg_catalog.length(pg_catalog.btrim(p_product_external_id)) = 0 then
    raise exception 'stable event, transaction and product identifiers are required';
  end if;
  if p_gross_amount is null or p_gross_amount < 0
    or p_net_amount is null or p_net_amount < 0
    or p_currency is null or p_currency !~ '^[A-Za-z]{3}$' then
    raise exception 'invalid sale amounts or currency';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Hotmart payload must be an object';
  end if;

  v_external_event_id := pg_catalog.btrim(p_external_event_id);
  v_external_transaction_id := pg_catalog.btrim(p_external_transaction_id);
  v_product_external_id := pg_catalog.btrim(p_product_external_id);

  v_payload := coalesce(p_payload, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'product_external_id', v_product_external_id
  );

  select event.id into v_event_by_external_id
  from public.sales_events event
  where event.connection_id = p_connection_id
    and event.external_event_id = v_external_event_id;

  select event.id into v_event_by_transaction_id
  from public.sales_events event
  where event.connection_id = p_connection_id
    and event.external_transaction_id = v_external_transaction_id
    and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED');

  if v_event_by_external_id is not null
    and v_event_by_transaction_id is not null
    and v_event_by_external_id <> v_event_by_transaction_id then
    raise exception 'Hotmart event and transaction identifiers conflict';
  end if;

  v_event_id := coalesce(v_event_by_external_id, v_event_by_transaction_id);
  if v_event_id is not null then
    select event.project_id, event.event_type
    into v_result_project_id, v_existing_event_type
    from public.sales_events event
    where event.id = v_event_id
    for update;
  end if;

  -- Do not replace a known producer payout with a gross fallback in a later delivery.
  if v_event_id is not null and p_payload #>> '{financial,payout}' is null then
    p_net_amount := coalesce((select event.net_amount from public.sales_events event
      where event.id = v_event_id and event.currency = pg_catalog.upper(p_currency)
      and (event.payload ->> 'net_amount_source' = 'producer_commission'
        or event.payload #>> '{financial,payout_source}' = 'producer_commission')), p_net_amount);
  end if;

  if v_event_id is not null
    and v_existing_event_type = 'PURCHASE_COMPLETED'
    and p_event_type = 'PURCHASE_APPROVED' then
    return query select v_event_id, true, v_result_project_id is not null;
    return;
  end if;

  insert into public.products (
    organization_id, connection_id, external_id, name, current_price, currency,
    source, provider_name, provider_price, provider_currency
  )
  values (
    v_organization_id, p_connection_id, v_product_external_id,
    coalesce(nullif(pg_catalog.btrim(p_product_name), ''), v_product_external_id),
    p_gross_amount, pg_catalog.upper(p_currency), 'provider',
    coalesce(nullif(pg_catalog.btrim(p_product_name), ''), v_product_external_id),
    p_gross_amount, pg_catalog.upper(p_currency)
  )
  on conflict (connection_id, external_id) do update
  set provider_name = excluded.provider_name,
      provider_price = excluded.provider_price,
      provider_currency = excluded.provider_currency,
      name = case
        when public.products.metadata @> '{"manual_override":true}'::jsonb
          then public.products.name
        else excluded.name
      end,
      current_price = case
        when public.products.metadata @> '{"manual_override":true}'::jsonb
          then public.products.current_price
        else excluded.current_price
      end,
      currency = case
        when public.products.metadata @> '{"manual_override":true}'::jsonb
          then public.products.currency
        else excluded.currency
      end,
      is_active = true
  returning id, name into v_product_id, v_product_name;

  select mapping.id, mapping.project_id, mapping.funnel_stage_id,
         coalesce(mapping.funnel_stage_name_snapshot, stage.name),
         coalesce(mapping.stage_type_snapshot, stage.stage_type)
  into v_mapping_id, v_project_id, v_stage_id, v_stage_name, v_stage_type
  from public.product_mappings mapping
  join public.projects project on project.id = mapping.project_id
  join public.funnel_stages stage on stage.id = mapping.funnel_stage_id
  join public.products product on product.id = mapping.product_id
  where mapping.organization_id = v_organization_id
    and mapping.product_id = v_product_id
    and mapping.effective_from <= p_event_at
    and (mapping.effective_to is null or mapping.effective_to > p_event_at)
    and project.currency = pg_catalog.upper(p_currency)
  order by mapping.effective_from desc
  limit 1;

  begin
    insert into public.sales_events (
      organization_id, project_id, connection_id, external_event_id,
      external_transaction_id, event_type, event_at, gross_amount, net_amount,
      currency, payload, processed_at
    )
    values (
      v_organization_id, v_project_id, p_connection_id, v_external_event_id,
      v_external_transaction_id, p_event_type, p_event_at, p_gross_amount,
      p_net_amount, pg_catalog.upper(p_currency), v_payload,
      case when v_project_id is null then null else now() end
    )
    returning id into v_event_id;
  exception when unique_violation then
    select event.id into v_event_by_external_id
    from public.sales_events event
    where event.connection_id = p_connection_id
      and event.external_event_id = v_external_event_id;

    select event.id into v_event_by_transaction_id
    from public.sales_events event
    where event.connection_id = p_connection_id
      and event.external_transaction_id = v_external_transaction_id
      and event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED');

    if v_event_by_external_id is not null
      and v_event_by_transaction_id is not null
      and v_event_by_external_id <> v_event_by_transaction_id then
      raise exception 'Hotmart event and transaction identifiers conflict';
    end if;

    v_event_id := coalesce(v_event_by_external_id, v_event_by_transaction_id);

    if v_event_id is null then
      raise;
    end if;
    select event.project_id, event.event_type
    into v_result_project_id, v_existing_event_type
    from public.sales_events event
    where event.id = v_event_id
    for update;
    if v_existing_event_type = 'PURCHASE_COMPLETED'
      and p_event_type = 'PURCHASE_APPROVED' then
      return query select v_event_id, true, v_result_project_id is not null;
      return;
    end if;

    update public.sales_events event
    set event_type = case
          when p_event_type = 'PURCHASE_COMPLETED' then p_event_type
          else event.event_type
        end,
        event_at = p_event_at,
        gross_amount = p_gross_amount,
        net_amount = p_net_amount,
        currency = pg_catalog.upper(p_currency),
        payload = v_payload,
        project_id = coalesce(event.project_id, v_project_id),
        processed_at = case
          when coalesce(event.project_id, v_project_id) is null then null
          else coalesce(event.processed_at, now())
        end
    where event.id = v_event_id
    returning event.project_id into v_result_project_id;

    update public.sales_event_items item
    set gross_amount = p_gross_amount,
        net_amount = p_net_amount
    where item.sales_event_id = v_event_id;

    if v_result_project_id is not null and not exists (
      select 1 from public.sales_event_items item
      where item.sales_event_id = v_event_id
    ) then
      insert into public.sales_event_items (
        organization_id, sales_event_id, product_id, funnel_stage_id,
        product_mapping_id, quantity, gross_amount, net_amount,
        product_name_snapshot, funnel_stage_name_snapshot, stage_type_snapshot
      )
      values (
        v_organization_id, v_event_id, v_product_id, v_stage_id,
        v_mapping_id, 1, p_gross_amount, p_net_amount,
        v_product_name, v_stage_name, v_stage_type
      );
    end if;

    return query select v_event_id, true, v_result_project_id is not null;
    return;
  end;

  if v_project_id is not null then
    insert into public.sales_event_items (
      organization_id, sales_event_id, product_id, funnel_stage_id,
      product_mapping_id, quantity, gross_amount, net_amount,
      product_name_snapshot, funnel_stage_name_snapshot, stage_type_snapshot
    )
    values (
      v_organization_id, v_event_id, v_product_id, v_stage_id,
      v_mapping_id, 1, p_gross_amount, p_net_amount,
      v_product_name, v_stage_name, v_stage_type
    );
  end if;

  return query select v_event_id, false, v_project_id is not null;
end;
$$;
revoke all on function public.ingest_hotmart_sale_unchecked(uuid,text,text,text,timestamptz,text,text,numeric,numeric,text,jsonb) from public,anon,authenticated,service_role;
