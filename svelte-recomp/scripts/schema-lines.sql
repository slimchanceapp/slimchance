-- The database's shape as sorted lines, for scripts/replay-migrations.sh --drift:
-- what it enforces (columns, keys, checks, indexes, row security, policies,
-- functions and who may call them, triggers, scheduled jobs, buckets), not
-- the order it was built in. Reads the catalog only, never anyone's rows.
select line from (
  select format('column %s.%s %s %s default=%s', table_name, column_name,
    case when data_type = 'ARRAY' then udt_name else data_type end,
    case when is_nullable = 'NO' then 'not-null' else 'null' end, coalesce(column_default, '-')) as line
  from information_schema.columns where table_schema = 'public'
  union all
  select format('constraint %s %s %s', conrelid::regclass, conname, pg_get_constraintdef(oid))
  from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select format('index %s', indexdef) from pg_indexes where schemaname = 'public'
  union all
  select format('rls %s %s', relname, relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
  union all
  select format('policy %s.%s "%s" %s to %s using(%s) check(%s)', schemaname, tablename, policyname, cmd,
    array_to_string(roles, ','), coalesce(qual, ''), coalesce(with_check, ''))
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select format('function %s(%s) definer=%s anon=%s authenticated=%s body=%s', proname, pg_get_function_identity_arguments(oid),
    prosecdef, has_function_privilege('anon', oid, 'execute'), has_function_privilege('authenticated', oid, 'execute'), md5(prosrc))
  from pg_proc where pronamespace = 'public'::regnamespace
  union all
  select format('trigger %s %s', tgrelid::regclass, pg_get_triggerdef(oid))
  from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'public.%'
  union all
  select format('cron %s %s', jobname, schedule) from cron.job
  union all
  select format('bucket %s public=%s limit=%s types=%s', id, public, file_size_limit, allowed_mime_types) from storage.buckets
) s
