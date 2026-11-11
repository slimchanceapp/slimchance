-- Trials share their own AI pool, and the daily digest counts new accounts
-- (2026-11-11 security pass). The day's shared ceiling is 150 AI calls and a
-- trial gets 10, so fifteen scripted trials (half an hour of sign-ups from one
-- address, under Supabase's limit) could switch the AI off for everyone until
-- midnight. Now trials together draw at most 60 a day from their own pool
-- ('trial:' + bucket in ai_usage_global), so accounts with an email always
-- keep the rest. Real use, for scale: at most 84 calls on any day in the 30
-- before 11-10, 16 by any one account. Otherwise as 20261110140000_ai_frugal.

create or replace function public.ai_take(p_bucket text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid   uuid    := auth.uid();
  trial boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  -- The most anyone gets a day, whatever the caller asks for.
  cap   integer := case p_bucket when 'ai' then 25 when 'search' then 400 else 25 end;
  lim   integer := least(greatest(coalesce(p_limit, 0), 0), cap);
  -- Everyone together, per day; trials together, per day.
  ceiling integer := case p_bucket when 'ai' then 150 when 'search' then 20000 else 150 end;
  trial_ceiling integer := case p_bucket when 'ai' then 60 when 'search' then 8000 else 60 end;
  n integer;
  g integer;
  t integer;
begin
  if uid is null then
    return false;
  end if;
  if trial then
    lim := least(lim, 10);
  end if;
  insert into public.ai_usage (user_id, day, bucket, calls)
  values (uid, (now() at time zone 'utc')::date, p_bucket, 1)
  on conflict (user_id, day, bucket) do update set calls = public.ai_usage.calls + 1
  returning calls into n;
  if n > lim then
    return false;
  end if;
  if trial then
    insert into public.ai_usage_global (day, bucket, calls)
    values ((now() at time zone 'utc')::date, 'trial:' || p_bucket, 1)
    on conflict (day, bucket) do update set calls = public.ai_usage_global.calls + 1
    returning calls into t;
    if t > trial_ceiling then
      return false;
    end if;
  end if;
  -- Counted only for calls inside a person's own allowance, so one account
  -- hammering past its cap can't use up everyone's day.
  insert into public.ai_usage_global (day, bucket, calls)
  values ((now() at time zone 'utc')::date, p_bucket, 1)
  on conflict (day, bucket) do update set calls = public.ai_usage_global.calls + 1
  returning calls into g;
  return g <= ceiling;
end;
$function$;

-- New accounts since a time, in totals only, for the health digest
-- (supabase/functions/health). Callable by the service role alone.
create or replace function public.health_signups(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'trials', count(*) filter (where u.is_anonymous),
    'accounts', count(*) filter (where not u.is_anonymous))
  from auth.users u
  where u.created_at >= p_since;
$function$;
revoke all on function public.health_signups(timestamptz) from public, anon, authenticated;
grant execute on function public.health_signups(timestamptz) to service_role;
