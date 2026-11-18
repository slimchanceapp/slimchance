-- Three more counts (2026-11-18), as before: one row per person, event and
-- day, read only as totals. play_open: the Google Play build was opened (the
-- 12 testers Google needs before Play opens). health_yes / health_later: the
-- answer to "bring in your watch and phone data?" on Today.
-- src/lib/metrics/events.ts lists the same names.
begin;

create or replace function public.note_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_event not in ('open', 'setup_1', 'setup_2', 'setup_3', 'setup_done', 'reminder_push', 'reminder_failed', 'reminder_calendar', 'plus_yes', 'plus_no', 'fit_yes', 'fit_unsure', 'fit_no', 'why_logging', 'why_scale', 'why_plan', 'why_confusing', 'why_broken', 'why_other', 'play_open', 'health_yes', 'health_later') then
    return;
  end if;
  insert into public.app_events (user_id, event) values (auth.uid(), p_event)
  on conflict do nothing;
end;
$$;
revoke all on function public.note_event(text) from public, anon;
grant execute on function public.note_event(text) to authenticated;

commit;
