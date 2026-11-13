-- How Slim Chance is used, from what the app already stores: no new tracking
-- (2026-11-13, Pact m25). Read-only; run it against production for the
-- Monday read. Every number is people (and days), over the last 30 days,
-- split into the owner and everyone else, so one person never passes for a
-- crowd. Return: of the people whose first open was at least N days ago, how
-- many opened again on day 1, in days 7 to 13, in days 30 to 36. Helping: of
-- the people with four weeks of weigh-ins, how many are at least half a kilo
-- nearer their goal in days 22 to 35 than in their first week.
with owners as (select user_id from public.app_owners),
-- Our own robots (phone tests, audits) are marked at sign-up and never counted.
robots as (select u.id as user_id from auth.users u where u.raw_user_meta_data ->> 'automated' = 'true'),
since as (select (now() at time zone 'utc')::date - 30 as d),
uses as (
  select 'weigh-in: ' || coalesce(w.source, 'typed') as feature, w.user_id, w.date::date as day from public.weights w, since where w.date::date >= since.d
  union all
  select 'food: ' || coalesce(f.source, case when f.barcode is not null then 'barcode' else 'typed' end), f.user_id, f.date::date from public.food_logs f, since where f.date::date >= since.d
  union all
  select 'workout: ' || coalesce(a.source, 'manual'), a.user_id, a.date::date from public.activity_sessions a, since where a.date::date >= since.d
  union all
  select 'gym sets', g.user_id, g.date::date from public.workout_logs g, since where g.date::date >= since.d
  union all
  select 'AI: ' || u.bucket, u.user_id, u.day::date from public.ai_usage u, since where u.day::date >= since.d
  union all
  select 'recipe made', r.user_id, r.created_at::date from public.recipes_custom r, since where r.created_at::date >= since.d
  union all
  select 'opened the app', e.user_id, e.day from public.app_events e, since where e.event = 'open' and e.day >= since.d
),
features as (
  select feature,
    count(distinct user_id) filter (where user_id not in (select user_id from owners) and user_id not in (select user_id from robots)) as people,
    count(distinct (user_id, day)) filter (where user_id not in (select user_id from owners) and user_id not in (select user_id from robots)) as people_days,
    count(distinct day) filter (where user_id in (select user_id from owners)) as owner_days
  from uses group by feature
),
firsts as (
  select e.user_id, min(e.day) as first from public.app_events e
  where e.event = 'open' and e.user_id not in (select user_id from owners) and e.user_id not in (select user_id from robots) group by e.user_id
),
returns as (
  select
    count(*) filter (where f.first <= current_date - 1) as d1_eligible,
    count(*) filter (where f.first <= current_date - 1 and exists (select 1 from public.app_events e where e.user_id = f.user_id and e.event = 'open' and e.day = f.first + 1)) as d1_back,
    count(*) filter (where f.first <= current_date - 13) as d7_eligible,
    count(*) filter (where f.first <= current_date - 13 and exists (select 1 from public.app_events e where e.user_id = f.user_id and e.event = 'open' and e.day between f.first + 7 and f.first + 13)) as d7_back,
    count(*) filter (where f.first <= current_date - 36) as d30_eligible,
    count(*) filter (where f.first <= current_date - 36 and exists (select 1 from public.app_events e where e.user_id = f.user_id and e.event = 'open' and e.day between f.first + 30 and f.first + 36)) as d30_back
  from firsts f
),
weighs as (
  select w.user_id, min(w.date::date) as first from public.weights w where w.user_id not in (select user_id from robots) group by w.user_id
),
helping as (
  select
    count(*) as four_weeks,
    count(*) filter (where s.goal_kg is not null and abs((late.kg - s.goal_kg)) <= abs((early.kg - s.goal_kg)) - 0.5) as nearer_goal,
    count(*) filter (where p.user_id in (select user_id from owners)) as of_them_owner
  from weighs p
  join lateral (select avg(w.weight) as kg from public.weights w where w.user_id = p.user_id and w.date::date between p.first and p.first + 6) early on true
  join lateral (select avg(w.weight) as kg, count(*) as n from public.weights w where w.user_id = p.user_id and w.date::date between p.first + 22 and p.first + 35) late on true
  left join public.user_settings s on s.user_id = p.user_id
  where late.n >= 2
)
select jsonb_build_object(
  'features_last_30_days', (select jsonb_agg(jsonb_build_object('feature', feature, 'people', people, 'people_days', people_days, 'owner_days', owner_days) order by people desc, owner_days desc) from features),
  'return_not_owner', (select to_jsonb(returns) from returns),
  'helping', (select to_jsonb(helping) from helping)
) as usage;
