do $legacy_functions$
declare
  legacy_function record;
  safe_search_path text;
begin
  for legacy_function in
    select procedure.oid, procedure.proname, procedure.oid::regprocedure::text as signature
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'handle_new_user',
        'rls_auto_enable',
        'increment_venda',
        'decrement_venda',
        'log_mudanca_produto'
      )
  loop
    safe_search_path := case
      when legacy_function.proname in ('handle_new_user', 'rls_auto_enable')
        then 'pg_catalog'
      else 'pg_catalog, public'
    end;

    execute pg_catalog.format(
      'alter function %s set search_path = %s',
      legacy_function.signature,
      safe_search_path
    );
    execute pg_catalog.format(
      'revoke all on function %s from public, anon, authenticated',
      legacy_function.signature
    );
    execute pg_catalog.format(
      'grant execute on function %s to service_role',
      legacy_function.signature
    );
  end loop;
end;
$legacy_functions$;
