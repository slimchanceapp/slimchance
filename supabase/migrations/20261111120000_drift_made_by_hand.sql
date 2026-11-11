-- The rest of what had been made by hand in production, found when the
-- replayed migrations were compared with it (scripts/replay-migrations.sh
-- --drift, 2026-11-11): the alarms' auto_key column and its unique index, an
-- index on physique snapshots, and four policies on physique_snapshots that
-- repeat, rule for rule, the own_rows_* ones 20260828120000 made. The copies
-- go; who can read or write what is unchanged. Safe to run twice.
begin;

alter table public.alarms add column if not exists auto_key text;
create unique index if not exists alarms_user_autokey_idx on public.alarms (user_id, auto_key);
create index if not exists physique_snapshots_user_date on public.physique_snapshots (user_id, date);

drop policy if exists "select own physique_snapshots" on public.physique_snapshots;
drop policy if exists "insert own physique_snapshots" on public.physique_snapshots;
drop policy if exists "update own physique_snapshots" on public.physique_snapshots;
drop policy if exists "delete own physique_snapshots" on public.physique_snapshots;

commit;
