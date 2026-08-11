alter table public.projects
  add column project_type text not null default 'launch'
    check (project_type in ('launch', 'perpetual', 'event')),
  add column starts_on date,
  add column ends_on date,
  add constraint projects_period_check
    check (ends_on is null or starts_on is null or ends_on >= starts_on);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  name text,
  email text,
  phone text,
  normalized_email text generated always as (
    nullif(pg_catalog.lower(pg_catalog.btrim(email)), '')
  ) stored,
  normalized_phone text generated always as (
    nullif(pg_catalog.regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
  ) stored,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  check (name is not null or normalized_email is not null or normalized_phone is not null),
  check (normalized_phone is null or pg_catalog.length(normalized_phone) between 8 and 15),
  check (last_seen_at >= first_seen_at),
  check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index contacts_active_email_unique
  on public.contacts (project_id, normalized_email)
  where normalized_email is not null and archived_at is null;
create unique index contacts_active_phone_unique
  on public.contacts (project_id, normalized_phone)
  where normalized_phone is not null and archived_at is null;
create index contacts_project_updated_idx
  on public.contacts (project_id, updated_at desc)
  where archived_at is null;
create index contacts_owner_idx
  on public.contacts (owner_user_id)
  where owner_user_id is not null and archived_at is null;

create table public.google_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  connection_id uuid not null,
  external_form_id text not null,
  title text not null,
  responder_uri text,
  revision_id text,
  schema_hash text,
  schema_version integer not null default 0 check (schema_version >= 0),
  field_mapping jsonb not null default '{}'::jsonb,
  response_cursor_at timestamptz,
  last_response_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, id),
  unique (organization_id, external_form_id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, connection_id)
    references public.integration_connections(organization_id, id) on delete restrict,
  check (pg_catalog.length(pg_catalog.btrim(external_form_id)) between 5 and 256),
  check (pg_catalog.length(pg_catalog.btrim(title)) between 1 and 500),
  check (pg_catalog.jsonb_typeof(field_mapping) = 'object')
);

create index google_forms_project_idx
  on public.google_forms (project_id, created_at desc)
  where archived_at is null;
create index google_forms_connection_idx on public.google_forms(connection_id);

create table public.google_form_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  google_form_id uuid not null,
  external_question_id text not null,
  external_item_id text,
  title text not null,
  question_type text not null,
  position integer not null check (position >= 0),
  required boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  first_seen_version integer not null check (first_seen_version >= 1),
  last_seen_version integer not null check (last_seen_version >= first_seen_version),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, google_form_id, id),
  unique (google_form_id, external_question_id),
  foreign key (organization_id, project_id, google_form_id)
    references public.google_forms(organization_id, project_id, id) on delete cascade,
  check (pg_catalog.jsonb_typeof(configuration) = 'object')
);

create index google_form_questions_form_position_idx
  on public.google_form_questions (google_form_id, position)
  where archived_at is null;

create table public.google_form_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  google_form_id uuid not null,
  contact_id uuid,
  external_response_id text not null,
  schema_version integer not null check (schema_version >= 1),
  response_created_at timestamptz not null,
  last_submitted_at timestamptz not null,
  respondent_email text,
  total_score numeric,
  match_status text not null default 'unresolved'
    check (match_status in ('matched', 'unresolved', 'conflict')),
  match_method text check (match_method in ('email', 'phone', 'email_and_phone', 'sid')),
  match_error text,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, id),
  unique (organization_id, project_id, google_form_id, id),
  unique (google_form_id, external_response_id),
  foreign key (organization_id, project_id, google_form_id)
    references public.google_forms(organization_id, project_id, id) on delete cascade,
  foreign key (organization_id, project_id, contact_id)
    references public.contacts(organization_id, project_id, id) on delete set null,
  check (last_submitted_at >= response_created_at),
  check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create index google_form_responses_form_date_idx
  on public.google_form_responses (google_form_id, last_submitted_at desc, external_response_id);
create index google_form_responses_contact_date_idx
  on public.google_form_responses (contact_id, last_submitted_at desc)
  where contact_id is not null;
create index google_form_responses_unresolved_idx
  on public.google_form_responses (project_id, last_submitted_at desc)
  where match_status <> 'matched';

create table public.google_form_answers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  google_form_id uuid not null,
  google_form_response_id uuid not null,
  google_form_question_id uuid not null,
  value jsonb not null default '[]'::jsonb,
  grade jsonb,
  question_title_snapshot text not null,
  question_type_snapshot text not null,
  updated_at timestamptz not null default now(),
  primary key (google_form_response_id, google_form_question_id),
  foreign key (organization_id, project_id, google_form_id, google_form_response_id)
    references public.google_form_responses(organization_id, project_id, google_form_id, id)
    on delete cascade,
  foreign key (organization_id, project_id, google_form_id, google_form_question_id)
    references public.google_form_questions(organization_id, project_id, google_form_id, id)
    on delete restrict,
  check (pg_catalog.jsonb_typeof(value) in ('array', 'object')),
  check (grade is null or pg_catalog.jsonb_typeof(grade) = 'object')
);

create index google_form_answers_question_idx
  on public.google_form_answers (google_form_question_id, google_form_response_id);

create table public.form_audiences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  google_form_id uuid,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id, google_form_id)
    references public.google_forms(organization_id, project_id, id) on delete restrict,
  check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 120)
);

create unique index form_audiences_active_name_unique
  on public.form_audiences (project_id, pg_catalog.lower(name))
  where archived_at is null;
create index form_audiences_form_idx
  on public.form_audiences (google_form_id)
  where google_form_id is not null and archived_at is null;

create table public.form_audience_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  audience_id uuid not null,
  contact_id uuid not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  invited_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (audience_id, contact_id),
  foreign key (organization_id, project_id, audience_id)
    references public.form_audiences(organization_id, project_id, id) on delete cascade,
  foreign key (organization_id, project_id, contact_id)
    references public.contacts(organization_id, project_id, id) on delete cascade
);

create index form_audience_members_contact_idx
  on public.form_audience_members (contact_id, audience_id);
create index form_audience_members_pending_idx
  on public.form_audience_members (audience_id, invited_at)
  where responded_at is null;

create table public.utm_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_id, id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete cascade,
  check (utm_source is not null or utm_medium is not null or utm_campaign is not null),
  check (last_seen_at >= first_seen_at)
);

create unique index utm_campaigns_dimensions_unique
  on public.utm_campaigns (project_id, utm_source, utm_medium, utm_campaign)
  nulls not distinct;
create index utm_campaigns_project_date_idx
  on public.utm_campaigns (project_id, last_seen_at desc);

create table public.contact_touchpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  contact_id uuid not null,
  utm_campaign_id uuid,
  google_form_response_id uuid,
  touchpoint_type text not null,
  occurred_at timestamptz not null,
  utm_term text,
  utm_content text,
  landing_url text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, project_id, id),
  foreign key (organization_id, project_id, contact_id)
    references public.contacts(organization_id, project_id, id) on delete cascade,
  foreign key (organization_id, project_id, utm_campaign_id)
    references public.utm_campaigns(organization_id, project_id, id) on delete restrict,
  foreign key (organization_id, project_id, google_form_response_id)
    references public.google_form_responses(organization_id, project_id, id) on delete cascade,
  check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create unique index contact_touchpoints_response_unique
  on public.contact_touchpoints (google_form_response_id)
  where google_form_response_id is not null;
create unique index contact_touchpoints_external_unique
  on public.contact_touchpoints (project_id, external_id)
  where external_id is not null;
create index contact_touchpoints_contact_date_idx
  on public.contact_touchpoints (contact_id, occurred_at desc);
create index contact_touchpoints_campaign_date_idx
  on public.contact_touchpoints (utm_campaign_id, occurred_at desc)
  where utm_campaign_id is not null;

alter table public.sales_events
  add column contact_id uuid,
  add constraint sales_events_organization_project_contact_fkey
    foreign key (organization_id, project_id, contact_id)
    references public.contacts(organization_id, project_id, id)
    on delete set null;

create index sales_events_project_contact_date_idx
  on public.sales_events (project_id, contact_id, event_at desc)
  where contact_id is not null;

create table public.sales_contact_attributions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  sales_event_id uuid not null,
  contact_id uuid not null,
  touchpoint_id uuid,
  attribution_model text not null default 'last_touch'
    check (attribution_model = 'last_touch'),
  attributed_amount numeric(14,2) not null,
  attributed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (sales_event_id, attribution_model),
  foreign key (organization_id, sales_event_id)
    references public.sales_events(organization_id, id) on delete cascade,
  foreign key (organization_id, project_id, contact_id)
    references public.contacts(organization_id, project_id, id) on delete restrict,
  foreign key (organization_id, project_id, touchpoint_id)
    references public.contact_touchpoints(organization_id, project_id, id) on delete restrict,
  check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create index sales_contact_attributions_project_date_idx
  on public.sales_contact_attributions (project_id, attributed_at desc);
create index sales_contact_attributions_contact_idx
  on public.sales_contact_attributions (contact_id, attributed_at desc);

alter table public.sync_runs
  add column google_form_id uuid,
  add constraint sync_runs_organization_project_google_form_fkey
    foreign key (organization_id, project_id, google_form_id)
    references public.google_forms(organization_id, project_id, id) on delete cascade,
  add constraint sync_runs_records_processed_check check (records_processed >= 0),
  add constraint sync_runs_period_check
    check (finished_at is null or started_at is null or finished_at >= started_at);

create index sync_runs_google_form_date_idx
  on public.sync_runs (google_form_id, created_at desc)
  where google_form_id is not null;
create index sync_runs_project_job_date_idx
  on public.sync_runs (project_id, job_type, created_at desc)
  where project_id is not null;
create unique index sync_runs_google_form_active_unique
  on public.sync_runs (google_form_id)
  where google_form_id is not null
    and job_type = 'google_forms.responses'
    and status in ('queued', 'running');

create trigger contacts_set_updated_at before update on public.contacts
for each row execute function public.set_updated_at();
create trigger google_forms_set_updated_at before update on public.google_forms
for each row execute function public.set_updated_at();
create trigger google_form_questions_set_updated_at before update on public.google_form_questions
for each row execute function public.set_updated_at();
create trigger google_form_responses_set_updated_at before update on public.google_form_responses
for each row execute function public.set_updated_at();
create trigger form_audiences_set_updated_at before update on public.form_audiences
for each row execute function public.set_updated_at();
create trigger utm_campaigns_set_updated_at before update on public.utm_campaigns
for each row execute function public.set_updated_at();

create trigger contacts_require_active_project
before insert or update or delete on public.contacts
for each row execute function public.enforce_active_project_reference();
create trigger google_forms_require_active_project
before insert or update or delete on public.google_forms
for each row execute function public.enforce_active_project_reference();
create trigger google_form_questions_require_active_project
before insert or update or delete on public.google_form_questions
for each row execute function public.enforce_active_project_reference();
create trigger google_form_responses_require_active_project
before insert or update or delete on public.google_form_responses
for each row execute function public.enforce_active_project_reference();
create trigger google_form_answers_require_active_project
before insert or update or delete on public.google_form_answers
for each row execute function public.enforce_active_project_reference();
create trigger form_audiences_require_active_project
before insert or update or delete on public.form_audiences
for each row execute function public.enforce_active_project_reference();
create trigger form_audience_members_require_active_project
before insert or update or delete on public.form_audience_members
for each row execute function public.enforce_active_project_reference();
create trigger utm_campaigns_require_active_project
before insert or update or delete on public.utm_campaigns
for each row execute function public.enforce_active_project_reference();
create trigger contact_touchpoints_require_active_project
before insert or update or delete on public.contact_touchpoints
for each row execute function public.enforce_active_project_reference();
create trigger sales_contact_attributions_require_active_project
before insert or update or delete on public.sales_contact_attributions
for each row execute function public.enforce_active_project_reference();

create or replace function public.attach_google_form(
  p_organization_id uuid,
  p_project_id uuid,
  p_connection_id uuid,
  p_external_form_id text,
  p_title text,
  p_responder_uri text,
  p_revision_id text,
  p_schema_hash text,
  p_field_mapping jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form_id uuid;
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  if pg_catalog.jsonb_typeof(coalesce(p_field_mapping, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid field mapping' using errcode = '22023';
  end if;

  perform 1
  from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.organization_id = p_organization_id
    and connection.provider = 'google_forms'
    and connection.revoked_at is null
  for update;
  if not found then
    raise exception 'active Google Forms connection not found' using errcode = 'P0002';
  end if;

  insert into public.google_forms (
    organization_id, project_id, connection_id, external_form_id,
    title, responder_uri, revision_id, schema_hash, field_mapping
  )
  values (
    p_organization_id, p_project_id, p_connection_id,
    pg_catalog.btrim(p_external_form_id), pg_catalog.btrim(p_title),
    p_responder_uri, p_revision_id, p_schema_hash,
    coalesce(p_field_mapping, '{}'::jsonb)
  )
  on conflict (organization_id, external_form_id) do update
  set title = excluded.title,
      responder_uri = excluded.responder_uri,
      revision_id = excluded.revision_id,
      schema_hash = excluded.schema_hash,
      field_mapping = excluded.field_mapping,
      archived_at = null,
      last_error = null
  where public.google_forms.project_id = excluded.project_id
    and public.google_forms.connection_id = excluded.connection_id
  returning id into v_form_id;

  if v_form_id is null then
    raise exception 'form is already attached to another project' using errcode = '23505';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  )
  values (
    p_organization_id, auth.uid(), 'google_form.attached', 'google_form',
    v_form_id::text,
    pg_catalog.jsonb_build_object('project_id', p_project_id)
  );

  return v_form_id;
end;
$$;

revoke all on function public.attach_google_form(
  uuid, uuid, uuid, text, text, text, text, text, jsonb
) from public, anon, service_role;
grant execute on function public.attach_google_form(
  uuid, uuid, uuid, text, text, text, text, text, jsonb
) to authenticated;

create or replace function public.update_google_form_mapping(
  p_organization_id uuid,
  p_project_id uuid,
  p_google_form_id uuid,
  p_field_mapping jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_active_project(p_organization_id, p_project_id);
  if pg_catalog.jsonb_typeof(coalesce(p_field_mapping, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid field mapping' using errcode = '22023';
  end if;

  update public.google_forms form
  set field_mapping = coalesce(p_field_mapping, '{}'::jsonb),
      last_error = null
  where form.id = p_google_form_id
    and form.organization_id = p_organization_id
    and form.project_id = p_project_id
    and form.archived_at is null;
  if not found then
    raise exception 'form not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, auth.uid(), 'google_form.mapping_updated',
    'google_form', p_google_form_id::text,
    pg_catalog.jsonb_build_object('project_id', p_project_id)
  );
end;
$$;

revoke all on function public.update_google_form_mapping(uuid, uuid, uuid, jsonb)
from public, anon, service_role;
grant execute on function public.update_google_form_mapping(uuid, uuid, uuid, jsonb)
to authenticated;

create or replace function public.sync_google_form_schema(
  p_google_form_id uuid,
  p_title text,
  p_responder_uri text,
  p_revision_id text,
  p_schema_hash text,
  p_questions jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.google_forms%rowtype;
  v_version integer;
begin
  if pg_catalog.jsonb_typeof(coalesce(p_questions, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid form questions' using errcode = '22023';
  end if;

  select form.* into v_form
  from public.google_forms form
  join public.projects project on project.id = form.project_id
  where form.id = p_google_form_id
    and form.archived_at is null
    and project.deleted_at is null
  for update of form;
  if not found then
    raise exception 'active form not found' using errcode = 'P0002';
  end if;

  v_version := case
    when v_form.schema_hash is distinct from p_schema_hash
      then v_form.schema_version + 1
    else greatest(v_form.schema_version, 1)
  end;

  update public.google_forms form
  set title = pg_catalog.btrim(p_title),
      responder_uri = p_responder_uri,
      revision_id = p_revision_id,
      schema_hash = p_schema_hash,
      schema_version = v_version,
      last_error = null
  where form.id = p_google_form_id;

  update public.google_form_questions question
  set archived_at = now(),
      last_seen_version = v_version
  where question.google_form_id = p_google_form_id
    and question.archived_at is null
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_questions) item
      where item ->> 'questionId' = question.external_question_id
    );

  insert into public.google_form_questions (
    organization_id, project_id, google_form_id, external_question_id,
    external_item_id, title, question_type, position, required,
    configuration, first_seen_version, last_seen_version, archived_at
  )
  select
    v_form.organization_id, v_form.project_id, p_google_form_id,
    item ->> 'questionId', nullif(item ->> 'itemId', ''),
    coalesce(nullif(item ->> 'title', ''), 'Pergunta sem titulo'),
    coalesce(nullif(item ->> 'type', ''), 'unknown'),
    coalesce((item ->> 'position')::integer, 0),
    coalesce((item ->> 'required')::boolean, false),
    coalesce(item -> 'configuration', '{}'::jsonb),
    v_version, v_version, null
  from pg_catalog.jsonb_array_elements(p_questions) item
  where nullif(item ->> 'questionId', '') is not null
  on conflict (google_form_id, external_question_id) do update
  set external_item_id = excluded.external_item_id,
      title = excluded.title,
      question_type = excluded.question_type,
      position = excluded.position,
      required = excluded.required,
      configuration = excluded.configuration,
      last_seen_version = excluded.last_seen_version,
      archived_at = null;

  return v_version;
end;
$$;

revoke all on function public.sync_google_form_schema(
  uuid, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.sync_google_form_schema(
  uuid, text, text, text, text, jsonb
) to service_role;

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

create view public.project_form_analytics
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

create view public.project_utm_analytics
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

create view public.project_product_revenue
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

create or replace function public.soft_delete_project(
  p_organization_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_at timestamptz := pg_catalog.clock_timestamp();
  v_name text;
  v_slug text;
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required' using errcode = '42501';
  end if;

  select project.name, project.slug
  into v_name, v_slug
  from public.projects project
  where project.id = p_project_id
    and project.organization_id = p_organization_id
    and project.deleted_at is null
  for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  delete from public.project_accounts link
  where link.project_id = p_project_id
    and link.organization_id = p_organization_id;

  update public.product_mappings mapping
  set effective_to = greatest(v_deleted_at, mapping.effective_from + interval '1 microsecond')
  where mapping.project_id = p_project_id
    and mapping.organization_id = p_organization_id
    and mapping.effective_to is null;

  update public.google_forms form
  set archived_at = v_deleted_at
  where form.project_id = p_project_id
    and form.organization_id = p_organization_id
    and form.archived_at is null;

  update public.projects project
  set deleted_at = v_deleted_at,
      status = 'archived'
  where project.id = p_project_id
    and project.organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, auth.uid(), 'project.deleted', 'project', p_project_id::text,
    pg_catalog.jsonb_build_object('name', v_name, 'slug', v_slug)
  );

  return pg_catalog.jsonb_build_object(
    'id', p_project_id,
    'name', v_name,
    'deletedAt', v_deleted_at
  );
end;
$$;

create or replace function public.delete_empty_integration_connection(
  p_organization_id uuid,
  p_connection_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'admin permission required';
  end if;

  perform 1
  from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.organization_id = p_organization_id
    and connection.status = 'revoked'
  for update;
  if not found then
    raise exception 'revoked connection not found';
  end if;

  if exists (
    select 1 from public.project_accounts link
    join public.provider_accounts account on account.id = link.provider_account_id
    where account.connection_id = p_connection_id
  ) or exists (
    select 1 from public.products product where product.connection_id = p_connection_id
  ) or exists (
    select 1 from public.sales_events event where event.connection_id = p_connection_id
  ) or exists (
    select 1 from public.traffic_metrics_daily metric
    join public.provider_accounts account on account.id = metric.provider_account_id
    where account.connection_id = p_connection_id
  ) or exists (
    select 1 from public.sync_runs run where run.connection_id = p_connection_id
  ) or exists (
    select 1 from public.google_forms form where form.connection_id = p_connection_id
  ) then
    raise exception 'connection has historical data';
  end if;

  delete from public.integration_connections connection
  where connection.id = p_connection_id
    and connection.organization_id = p_organization_id;
end;
$$;

alter table public.contacts enable row level security;
alter table public.google_forms enable row level security;
alter table public.google_form_questions enable row level security;
alter table public.google_form_responses enable row level security;
alter table public.google_form_answers enable row level security;
alter table public.form_audiences enable row level security;
alter table public.form_audience_members enable row level security;
alter table public.utm_campaigns enable row level security;
alter table public.contact_touchpoints enable row level security;
alter table public.sales_contact_attributions enable row level security;

create policy contacts_admin_read on public.contacts
for select to authenticated using (public.is_org_admin(organization_id));
create policy google_forms_admin_read on public.google_forms
for select to authenticated using (public.is_org_admin(organization_id));
create policy google_form_questions_admin_read on public.google_form_questions
for select to authenticated using (public.is_org_admin(organization_id));
create policy google_form_responses_admin_read on public.google_form_responses
for select to authenticated using (public.is_org_admin(organization_id));
create policy google_form_answers_admin_read on public.google_form_answers
for select to authenticated using (public.is_org_admin(organization_id));
create policy form_audiences_admin_read on public.form_audiences
for select to authenticated using (public.is_org_admin(organization_id));
create policy form_audience_members_admin_read on public.form_audience_members
for select to authenticated using (public.is_org_admin(organization_id));
create policy utm_campaigns_admin_read on public.utm_campaigns
for select to authenticated using (public.is_org_admin(organization_id));
create policy contact_touchpoints_admin_read on public.contact_touchpoints
for select to authenticated using (public.is_org_admin(organization_id));
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
