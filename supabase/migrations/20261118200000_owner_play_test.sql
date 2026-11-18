-- The Play closed test, as totals (2026-11-18). Of the people who opened the
-- Google Play build (play_open): how many finished setup, weighed in, came
-- back on a second day, and opened it in the last 7 days; and how many
-- answered the watch-data card. Google's own count of opted-in testers lives
-- in Play Console; this is what they do. Owner only, the owner left out, as
-- on the rest of the Numbers page, and never a list of people.
begin;

create or replace function public.owner_play_test()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.app_owners where user_id = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with play as (
    select user_id, min(day) as first_day
    from public.app_events
    where event = 'play_open' and user_id not in (select user_id from public.app_owners)
    group by user_id
  ), opens as (
    select e.user_id, count(distinct e.day) as days, max(e.day) as last_day
    from public.app_events e
    join play p on p.user_id = e.user_id
    where e.event = 'open'
    group by e.user_id
  )
  select jsonb_build_object(
    'opened', (select count(*) from play),
    'setup', (select count(*) from play p where exists (select 1 from public.app_events e where e.user_id = p.user_id and e.event = 'setup_done')),
    'weighed', (select count(*) from play p where exists (select 1 from public.weights w where w.user_id = p.user_id)),
    'back', (select count(*) from opens where days >= 2),
    'week', (select count(*) from opens where last_day >= (now() at time zone 'utc')::date - 6),
    'since', (select min(first_day) from play),
    'health_yes', (select count(distinct user_id) from public.app_events where event = 'health_yes' and user_id not in (select user_id from public.app_owners)),
    'health_later', (select count(distinct user_id) from public.app_events where event = 'health_later' and user_id not in (select user_id from public.app_owners))
  ) into result;
  return result;
end;
$$;

revoke all on function public.owner_play_test() from public, anon;
grant execute on function public.owner_play_test() to authenticated;

commit;
