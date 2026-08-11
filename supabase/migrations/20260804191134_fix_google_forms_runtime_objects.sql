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
    and v_existing_submitted_at > v_submitted_at then
    return pg_catalog.jsonb_build_object(
      'id', v_response_id,
      'duplicate', true,
      'status', 'older_version'
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

create or replace view public.project_form_analytics
with (security_invoker = true)
as
select
  form.organization_id,
  form.project_id,
  form.id as google_form_id,
  form.title,
  count(response.id) as total_responses,
  count(distinct response.contact_id) filter (
    where response.contact_id is not null
  ) as unique_respondents,
  count(response.id) filter (where response.match_status = 'matched') as matched_responses,
  count(response.id) filter (where response.match_status = 'unresolved') as unresolved_responses,
  count(response.id) filter (where response.match_status = 'conflict') as conflict_responses,
  max(response.last_submitted_at) as latest_response_at
from public.google_forms form
left join public.google_form_responses response on response.google_form_id = form.id
where form.archived_at is null
group by form.organization_id, form.project_id, form.id, form.title;

create or replace view public.project_utm_analytics
with (security_invoker = true)
as
select
  campaign.organization_id,
  campaign.project_id,
  campaign.id as utm_campaign_id,
  campaign.utm_source,
  campaign.utm_medium,
  campaign.utm_campaign,
  count(distinct touchpoint.contact_id) as contacts,
  count(distinct touchpoint.google_form_response_id) as responses,
  max(touchpoint.occurred_at) as latest_touch_at
from public.utm_campaigns campaign
left join public.contact_touchpoints touchpoint
  on touchpoint.utm_campaign_id = campaign.id
group by campaign.organization_id, campaign.project_id, campaign.id,
  campaign.utm_source, campaign.utm_medium, campaign.utm_campaign;

create or replace view public.project_product_revenue
with (security_invoker = true)
as
select
  event.organization_id,
  event.project_id,
  item.product_id,
  coalesce(item.product_name_snapshot, product.name, 'Produto sem nome') as product_name,
  count(distinct event.id) filter (
    where event.event_type in ('PURCHASE_APPROVED', 'PURCHASE_COMPLETED')
  ) as sales,
  count(distinct event.id) filter (
    where event.event_type = 'PURCHASE_REFUNDED'
  ) as refunds,
  coalesce(pg_catalog.sum(item.gross_amount), 0) as gross_revenue,
  coalesce(pg_catalog.sum(item.net_amount), 0) as net_revenue
from public.sales_events event
left join public.sales_event_items item on item.sales_event_id = event.id
left join public.products product on product.id = item.product_id
where event.project_id is not null
group by event.organization_id, event.project_id, item.product_id,
  coalesce(item.product_name_snapshot, product.name, 'Produto sem nome');

drop policy if exists contacts_admin_read on public.contacts;
create policy contacts_admin_read on public.contacts
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists google_forms_admin_read on public.google_forms;
create policy google_forms_admin_read on public.google_forms
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists google_form_questions_admin_read on public.google_form_questions;
create policy google_form_questions_admin_read on public.google_form_questions
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists google_form_responses_admin_read on public.google_form_responses;
create policy google_form_responses_admin_read on public.google_form_responses
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists google_form_answers_admin_read on public.google_form_answers;
create policy google_form_answers_admin_read on public.google_form_answers
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists form_audiences_admin_read on public.form_audiences;
create policy form_audiences_admin_read on public.form_audiences
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists form_audience_members_admin_read on public.form_audience_members;
create policy form_audience_members_admin_read on public.form_audience_members
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists utm_campaigns_admin_read on public.utm_campaigns;
create policy utm_campaigns_admin_read on public.utm_campaigns
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists contact_touchpoints_admin_read on public.contact_touchpoints;
create policy contact_touchpoints_admin_read on public.contact_touchpoints
for select to authenticated using (public.is_org_admin(organization_id));
drop policy if exists sales_contact_attributions_admin_read on public.sales_contact_attributions;
create policy sales_contact_attributions_admin_read on public.sales_contact_attributions
for select to authenticated using (public.is_org_admin(organization_id));

revoke all on table
  public.contacts,
  public.google_forms,
  public.google_form_questions,
  public.google_form_responses,
  public.google_form_answers,
  public.form_audiences,
  public.form_audience_members,
  public.utm_campaigns,
  public.contact_touchpoints,
  public.sales_contact_attributions
from public, anon, authenticated;

grant select on table
  public.contacts,
  public.google_forms,
  public.google_form_questions,
  public.google_form_responses,
  public.google_form_answers,
  public.form_audiences,
  public.form_audience_members,
  public.utm_campaigns,
  public.contact_touchpoints,
  public.sales_contact_attributions
to authenticated;

grant all on table
  public.contacts,
  public.google_forms,
  public.google_form_questions,
  public.google_form_responses,
  public.google_form_answers,
  public.form_audiences,
  public.form_audience_members,
  public.utm_campaigns,
  public.contact_touchpoints,
  public.sales_contact_attributions
to service_role;

revoke all on table
  public.project_form_analytics,
  public.project_utm_analytics,
  public.project_product_revenue
from public, anon, authenticated;
grant select on table
  public.project_form_analytics,
  public.project_utm_analytics,
  public.project_product_revenue
to authenticated, service_role;
