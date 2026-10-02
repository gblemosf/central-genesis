-- Commit the enum addition before the Assiny routines use it.
alter type public.integration_provider add value if not exists 'assiny';
