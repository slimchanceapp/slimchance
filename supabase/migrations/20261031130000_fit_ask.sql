-- "Is Slim Chance for you?" (2026-10-31): asked once, on days 3 to 7, of
-- people who finished setup; one tap for the answer and one for what's in
-- the way. Counted like the setup steps: one row per person, answer and day,
-- in our own database, read only as totals. src/lib/events.ts lists the
-- same names.
begin;

create or replace function public.note_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_event not in ('open', 'setup_1', 'setup_2', 'setup_3', 'setup_done', 'reminder_push', 'reminder_failed', 'reminder_calendar', 'plus_yes', 'plus_no', 'fit_yes', 'fit_unsure', 'fit_no', 'why_logging', 'why_scale', 'why_plan', 'why_confusing', 'why_broken', 'why_other') then
    return;
  end if;
  insert into public.app_events (user_id, event) values (auth.uid(), p_event)
  on conflict do nothing;
end;
$$;
revoke all on function public.note_event(text) from public, anon;
grant execute on function public.note_event(text) to authenticated;

-- owner_metrics as in 20261031120000_came_from, with the answers counted.
create or replace function public.owner_metrics(p_days integer default 90)
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

  with people as (
    select u.id, (u.created_at at time zone 'utc')::date as joined, u.is_anonymous,
      coalesce(o.came_from, 'untagged') as came_from
    from auth.users u
    left join public.app_origins o on o.user_id = u.id
    where u.created_at > now() - make_interval(days => greatest(p_days, 1))
      and u.id not in (select user_id from public.app_owners)
  ),
  per as (
    select
      p.id, p.joined, p.is_anonymous, p.came_from,
      exists (select 1 from public.app_events e where e.user_id = p.id and e.event = 'setup_1') as setup_1,
      exists (select 1 from public.app_events e where e.user_id = p.id and e.event = 'setup_2') as setup_2,
      exists (select 1 from public.app_events e where e.user_id = p.id and e.event = 'setup_3') as setup_3,
      exists (select 1 from public.app_events e where e.user_id = p.id and e.event = 'setup_done')
        or exists (select 1 from public.user_settings s where s.user_id = p.id and s.onboarded_at is not null) as setup_done,
      (select min(w.date) from public.weights w where w.user_id = p.id) as first_weigh,
      (select count(*) from public.food_logs f where f.user_id = p.id) as food_rows,
      greatest(
        (select max(w.date) from public.weights w where w.user_id = p.id),
        (select max(f.date) from public.food_logs f where f.user_id = p.id),
        (select max(e.day) from public.app_events e where e.user_id = p.id)
      ) as last_seen
    from people p
  ),
  scored as (
    select per.*,
      (select count(distinct w.date) from public.weights w
        where w.user_id = per.id and w.date <= per.first_weigh + 6) as first_week_weighs
    from per
  )
  select jsonb_build_object(
    'days', greatest(p_days, 1),
    'funnel', jsonb_build_array(
      jsonb_build_object('step', 'Signed up', 'people', count(*)),
      jsonb_build_object('step', 'Saw setup', 'people', count(*) filter (where setup_1 or setup_done)),
      jsonb_build_object('step', 'Setup screen 2', 'people', count(*) filter (where setup_2 or setup_done)),
      jsonb_build_object('step', 'Setup screen 3', 'people', count(*) filter (where setup_3 or setup_done)),
      jsonb_build_object('step', 'Finished setup', 'people', count(*) filter (where setup_done)),
      jsonb_build_object('step', 'First weigh-in', 'people', count(*) filter (where first_weigh is not null)),
      jsonb_build_object('step', 'Weighed in 3 of first 7 days', 'people', count(*) filter (where first_week_weighs >= 3)),
      jsonb_build_object('step', 'Back after a week', 'people', count(*) filter (where last_seen >= joined + 7)),
      jsonb_build_object('step', 'Back after four weeks', 'people', count(*) filter (where last_seen >= joined + 28))
    ),
    -- The same steps, a row per tag: which posts bring people who stay.
    'by_from', coalesce((
      select jsonb_agg(jsonb_build_object('from', came_from, 'joined', joined_n, 'setup', setup_n,
        'weighed', weighed_n, 'three_of_seven', active_n, 'week', week_n, 'month', month_n) order by joined_n desc, came_from)
      from (
        select came_from, count(*) as joined_n,
          count(*) filter (where setup_done) as setup_n,
          count(*) filter (where first_weigh is not null) as weighed_n,
          count(*) filter (where first_week_weighs >= 3) as active_n,
          count(*) filter (where last_seen >= joined + 7) as week_n,
          count(*) filter (where last_seen >= joined + 28) as month_n
        from scored group by came_from
      ) g
    ), '[]'::jsonb),
    -- "Is Slim Chance for you?" (days 3 to 7): people per answer and reason.
    'fit', coalesce((
      select jsonb_object_agg(event, n) from (
        select e.event, count(distinct e.user_id) as n from public.app_events e
        where e.event ~ '^(fit|why)_' and e.user_id in (select id from scored)
        group by e.event
      ) f
    ), '{}'::jsonb),
    'logged_food', count(*) filter (where food_rows > 0),
    'trials', count(*) filter (where is_anonymous),
    'saved_accounts', count(*) filter (where not is_anonymous),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('week', wk, 'people', n) order by wk)
      from (select date_trunc('week', joined)::date as wk, count(*) as n from scored group by 1) w
    ), '[]'::jsonb),
    'opens', coalesce((
      select jsonb_agg(jsonb_build_object('day', day, 'people', n) order by day)
      from (
        select e.day, count(distinct e.user_id) as n from public.app_events e
        where e.event = 'open' and e.day > (now() at time zone 'utc')::date - 30
          and e.user_id not in (select user_id from public.app_owners)
        group by 1
      ) o
    ), '[]'::jsonb),
    'errors', coalesce((
      select jsonb_agg(jsonb_build_object('message', message, 'times', times, 'people', people, 'last', last) order by last desc)
      from (
        select c.message, sum(c.count) as times, count(distinct c.user_id) as people, max(c.last_seen) as last
        from public.client_errors c
        where c.last_seen > now() - interval '14 days'
          and c.user_id not in (select user_id from public.app_owners)
        group by c.message
        order by max(c.last_seen) desc
        limit 15
      ) x
    ), '[]'::jsonb)
  ) into result
  from scored;
  return result;
end;
$$;
revoke all on function public.owner_metrics(integer) from public, anon;
grant execute on function public.owner_metrics(integer) to authenticated;

commit;
