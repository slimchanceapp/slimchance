-- Google's own count of opted-in Play testers (2026-11-18). Only Play Console
-- knows it, behind the owner's login, so the laptop reads it each morning, or
-- at the next login when it was off (a systemd timer with Persistent=true, see
-- ~/.local/share/slimchance/play/count.mjs --save), and keeps it here: one row,
-- RLS on and no policies, read only through owner_play_test().
begin;

create table if not exists public.play_status (
  id int primary key default 1 check (id = 1),
  google_opted_in int not null,
  checked_at timestamptz not null default now()
);
alter table public.play_status enable row level security;
revoke all on public.play_status from anon, authenticated;

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
    'health_later', (select count(distinct user_id) from public.app_events where event = 'health_later' and user_id not in (select user_id from public.app_owners)),
    'google', (select google_opted_in from public.play_status where id = 1),
    'google_at', (select checked_at from public.play_status where id = 1)
  ) into result;
  return result;
end;
$$;

revoke all on function public.owner_play_test() from public, anon;
grant execute on function public.owner_play_test() to authenticated;

commit;
