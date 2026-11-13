-- The tap map (2026-11-13, Pact m32): which named buttons get pressed on which
-- screen, one row per day, screen and name with a count, and nothing that says
-- who. The app counts only elements named in code (data-tap), never what a
-- button shows, and nothing from our own robots (src/lib/metrics/events.ts).
-- Written only through note_taps; read only by the owner, through SQL.
begin;

create table if not exists public.app_taps (
  day date not null default (now() at time zone 'utc')::date,
  screen text not null,
  name text not null,
  n integer not null default 0,
  primary key (day, screen, name)
);
alter table public.app_taps enable row level security;
-- No policies: nobody reads or writes the table directly.

create or replace function public.note_taps(p_taps jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  t jsonb;
  v_screen text;
  v_name text;
  v_n integer;
begin
  if jsonb_typeof(p_taps) is distinct from 'array' then
    return;
  end if;
  for t in select value from jsonb_array_elements(p_taps) limit 50 loop
    v_screen := t ->> 'screen';
    v_name := t ->> 'name';
    v_n := case when (t ->> 'n') ~ '^[0-9]{1,3}$' then least((t ->> 'n')::integer, 100) else 0 end;
    if v_n = 0 or v_screen is null or v_name is null
       or v_screen !~ '^/[a-z0-9/_-]{0,40}$' or v_name !~ '^[a-z0-9_-]{1,40}$' then
      continue;
    end if;
    -- ponytail: anyone can call this, so a flood of made-up names could only
    -- add rows; past 2000 rows in a day, new ones fold into one.
    if not exists (select 1 from public.app_taps a where a.day = today and a.screen = v_screen and a.name = v_name)
       and (select count(*) from public.app_taps a where a.day = today) >= 2000 then
      v_screen := '/';
      v_name := 'other';
    end if;
    insert into public.app_taps (day, screen, name, n) values (today, v_screen, v_name, v_n)
    on conflict (day, screen, name) do update set n = public.app_taps.n + excluded.n;
  end loop;
end;
$$;
revoke all on function public.note_taps(jsonb) from public;
grant execute on function public.note_taps(jsonb) to anon, authenticated;

commit;
