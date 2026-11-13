-- The tap map is counted only inside the app (2026-11-13): every named button
-- lives behind sign-in (a trial is signed in too), so signed-out callers need
-- no way to add counts. The security advisor flagged the anon grant.
begin;
revoke execute on function public.note_taps(jsonb) from anon;
commit;
