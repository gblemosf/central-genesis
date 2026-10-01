-- Enum additions commit separately before routines use the new provider.
alter type public.integration_provider add value if not exists 'payt';
