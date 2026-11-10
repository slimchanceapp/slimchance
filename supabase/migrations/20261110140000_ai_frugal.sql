-- ai_take, frugal (2026-11-10): Gemini runs on a prepaid balance, the app's
-- only AI money, and it ran out the same day (eval runs on the app's key spent
-- it; evals can no longer touch it). The allowances now fit what the app
-- really uses: over the 30 days before, 195 AI calls in all, at most 84 on any
-- day and 16 by any one account. So 25 a day per account (10 for a trial) and
-- 150 a day for everyone together: almost twice the busiest real day, and a
-- hard ceiling on what any day can cost. Otherwise as 20261028110000_ai_take_cap.

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
  -- Everyone together, per day.
  ceiling integer := case p_bucket when 'ai' then 150 when 'search' then 20000 else 150 end;
  n integer;
  g integer;
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
  -- Counted only for calls inside a person's own allowance, so one account
  -- hammering past its cap can't use up everyone's day.
  insert into public.ai_usage_global (day, bucket, calls)
  values ((now() at time zone 'utc')::date, p_bucket, 1)
  on conflict (day, bucket) do update set calls = public.ai_usage_global.calls + 1
  returning calls into g;
  return g <= ceiling;
end;
$function$;
