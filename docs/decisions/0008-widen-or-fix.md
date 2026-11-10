# 0008: Strangers return on 12 Nov; widen or fix by a bar set before the data

**Date:** 2026-11-10. **Follows:** [0003](0003-mission-and-who-first.md), whose week-4
measure can't be read until mid-December.

## Decision
- **Restart on Thu 12 Nov**, three days before the exploration's planned end:
  the posts go out, the Google Play closed test opens, and Show HN and an
  AlternativeTo listing follow (drafts in `svelte-recomp/store/posts/`).
- **The first read is the first week**, because week 4 can't exist yet. The
  cohort is the first 10 people who:
  - came by a public post's link (a tag starting `post-` or `r-`, or `hn`,
    `alternativeto`, `producthunt`), so friends and test runs don't count;
  - finished setup on or after 12 Nov;
  - set a goal below their first weigh-in, so people trying apps without
    trying to lose weight don't count.
- **Read once the tenth has had 7 days.** Widen (more posts, Play's open test)
  if 3 or more of the 10 weighed in on 3 of their first 7 days. Fix the first
  week again if 0 or 1 did. Exactly 2: read the next 10 the same way.
- **The query below is the definition.** Run it read-only; it prints the
  verdict. Changing it after 12 Nov means a new record, not an edit.

## Why
- A bar written before the data can't be bent to fit it, by us or by hope.
- With 10 people, 3 of 10 still means anywhere from about 1 in 10 to 6 in 10
  (Wilson 95% interval), so this bar only tells "nobody stays" from "some do".
  At this size that's the one question the data can answer honestly; anything
  finer needs the next 10.
- The drafts go to maker forums, because the communities of people losing
  weight ban promotion. Makers try apps rather than diet, hence the goal
  filter.

## What would change it
Fewer than 10 such people by 30 Nov: then the channels are the problem, not
the first week, and the next record is about where the posts go.

## The query
```sql
with strangers as (
  select u.id, s.onboarded_at, s.goal_kg,
         (select min(w.date) from public.weights w where w.user_id = u.id) as first_day
  from auth.users u
  join public.app_origins o on o.user_id = u.id
  join public.user_settings s on s.user_id = u.id
  where u.id not in (select user_id from public.app_owners)
    and (o.came_from like 'post-%' or o.came_from like 'r-%' or o.came_from in ('hn', 'alternativeto', 'producthunt'))
    and s.onboarded_at >= '2026-11-12'
),
cohort as (
  select st.*, (select min(w.weight) from public.weights w where w.user_id = st.id and w.date = st.first_day) as first_kg
  from strangers st where st.first_day is not null
),
first10 as (
  select c.*, (select count(distinct w.date) from public.weights w
               where w.user_id = c.id and w.date between c.first_day and c.first_day + 6) as days_weighed
  from cohort c where c.goal_kg < c.first_kg
  order by c.onboarded_at limit 10
)
select count(*) as in_cohort,
       count(*) filter (where first_day + 6 < current_date) as had_their_week,
       count(*) filter (where days_weighed >= 3) as weighed_3_of_7,
       case when count(*) filter (where first_day + 6 < current_date) < 10 then 'not yet'
            when count(*) filter (where days_weighed >= 3) >= 3 then 'widen'
            when count(*) filter (where days_weighed >= 3) <= 1 then 'fix the first week'
            else 'read the next 10' end as verdict
from first10;
```
