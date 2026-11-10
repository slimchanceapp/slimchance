-- Are we helping? (decision 0003, 2026-11-10): owner_metrics as in
-- 20261031130000_fit_ask, plus the two outcome counts: people still weighing
-- in at week 4, and people whose week-8 average moved half a kilo or more
-- toward their goal. Totals only, owners left out, as before.
begin;

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
      (select s.goal_kg from public.user_settings s where s.user_id = p.id) as goal_kg,
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
        where w.user_id = per.id and w.date <= per.first_weigh + 6) as first_week_weighs,
      (select avg(w.weight) from public.weights w
        where w.user_id = per.id and w.date <= per.first_weigh + 6) as start_kg,
      (select count(distinct w.date) from public.weights w
        where w.user_id = per.id and w.date between per.first_weigh + 21 and per.first_weigh + 34) as week4_weighs,
      (select avg(w.weight) from public.weights w
        where w.user_id = per.id and w.date between per.first_weigh + 49 and per.first_weigh + 62) as week8_kg,
      (select count(distinct w.date) from public.weights w
        where w.user_id = per.id and w.date between per.first_weigh + 49 and per.first_weigh + 62) as week8_weighs
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
    -- Decision 0003: are we helping? Week 4: at least two weigh-ins in days
    -- 22 to 35 after the first. Week 8: week 8's average at least half a kilo
    -- nearer the goal than week 1's. Each counted only among people who have
    -- had the time to get there.
    'outcomes', jsonb_build_object(
      'week4_eligible', count(*) filter (where first_weigh <= (now() at time zone 'utc')::date - 35),
      'week4_weighing', count(*) filter (where first_weigh <= (now() at time zone 'utc')::date - 35 and week4_weighs >= 2),
      'week8_eligible', count(*) filter (where first_weigh <= (now() at time zone 'utc')::date - 63),
      'week8_measured', count(*) filter (where first_weigh <= (now() at time zone 'utc')::date - 63 and week8_weighs >= 2 and goal_kg is not null),
      'week8_toward_goal', count(*) filter (where first_weigh <= (now() at time zone 'utc')::date - 63 and week8_weighs >= 2 and goal_kg is not null
        and sign(goal_kg - start_kg) = sign(week8_kg - start_kg) and abs(week8_kg - start_kg) >= 0.5)
    ),
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
