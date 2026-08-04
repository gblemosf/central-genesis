alter table public.projects
  add column deleted_at timestamptz;

create index projects_active_organization_created_idx
  on public.projects (organization_id, created_at)
  where deleted_at is null;
