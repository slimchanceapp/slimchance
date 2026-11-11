-- Tables made by hand in July 2026, before every change went through a
-- migration: settings, the watch's nightly numbers, food, the training week,
-- its logs and custom sessions, progress photos, and the photos' storage
-- bucket with two of its policies. Written down on 2026-11-11, when replaying
-- every migration on an empty database failed on the first of them: the repo
-- could not rebuild its own backend (scripts/replay-migrations.sh).
--
-- Each table as it first was, read from production; the migrations after
-- this one add the rest, as they did there. Safe to run twice, and a no-op on
-- production, where all of it exists.
begin;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal_kg numeric not null default 90,
  updated_at timestamptz not null default now(),
  goal_reason text,
  age smallint
);

create table if not exists public.biometrics (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  sleep_hours numeric,
  sleep_quality smallint,
  resting_hr smallint,
  hrv numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table if not exists public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  name text not null,
  kcal numeric not null default 0,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists food_logs_user_date_idx on public.food_logs (user_id, date);

create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  angle text not null default 'front',
  storage_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists progress_photos_user_date_idx on public.progress_photos (user_id, date);

create table if not exists public.workout_logs (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  exercise_name text not null,
  session_key text,
  sets jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, date, exercise_name)
);

create table if not exists public.workout_schedule (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_of_week integer not null,
  label text not null,
  session_key text,
  note text,
  updated_at timestamptz not null default now(),
  time text,
  primary key (user_id, day_of_week)
);

create table if not exists public.workout_sessions_custom (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  name text not null,
  duration text,
  focus text,
  exercises jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_settings enable row level security;
alter table public.biometrics enable row level security;
alter table public.food_logs enable row level security;
alter table public.progress_photos enable row level security;
alter table public.workout_logs enable row level security;
alter table public.workout_schedule enable row level security;
alter table public.workout_sessions_custom enable row level security;

-- Each person reads and writes only their own rows. The policies a later
-- migration adds (own_rows_delete on user_settings and biometrics,
-- own_rows_update on progress_photos) are left to it.
do $$
declare p record;
begin
  for p in select * from (values
    ('user_settings', 'own_rows_select', 'select', 'auth.uid() = user_id', null),
    ('user_settings', 'own_rows_insert', 'insert', null, 'auth.uid() = user_id'),
    ('user_settings', 'own_rows_update', 'update', 'auth.uid() = user_id', 'auth.uid() = user_id'),
    ('biometrics', 'select own biometrics', 'select', 'auth.uid() = user_id', null),
    ('biometrics', 'insert own biometrics', 'insert', null, 'auth.uid() = user_id'),
    ('biometrics', 'update own biometrics', 'update', 'auth.uid() = user_id', null),
    ('food_logs', 'select own food_logs', 'select', 'auth.uid() = user_id', null),
    ('food_logs', 'insert own food_logs', 'insert', null, 'auth.uid() = user_id'),
    ('food_logs', 'update own food_logs', 'update', 'auth.uid() = user_id', null),
    ('food_logs', 'delete own food_logs', 'delete', 'auth.uid() = user_id', null),
    ('progress_photos', 'select own progress_photos', 'select', 'auth.uid() = user_id', null),
    ('progress_photos', 'insert own progress_photos', 'insert', null, 'auth.uid() = user_id'),
    ('progress_photos', 'delete own progress_photos', 'delete', 'auth.uid() = user_id', null),
    ('workout_logs', 'select own workout_logs', 'select', 'auth.uid() = user_id', null),
    ('workout_logs', 'insert own workout_logs', 'insert', null, 'auth.uid() = user_id'),
    ('workout_logs', 'update own workout_logs', 'update', 'auth.uid() = user_id', null),
    ('workout_logs', 'delete own workout_logs', 'delete', 'auth.uid() = user_id', null),
    ('workout_schedule', 'own_rows_select', 'select', 'auth.uid() = user_id', null),
    ('workout_schedule', 'own_rows_insert', 'insert', null, 'auth.uid() = user_id'),
    ('workout_schedule', 'own_rows_update', 'update', 'auth.uid() = user_id', 'auth.uid() = user_id'),
    ('workout_schedule', 'own_rows_delete', 'delete', 'auth.uid() = user_id', null),
    ('workout_sessions_custom', 'own_rows_select', 'select', 'auth.uid() = user_id', null),
    ('workout_sessions_custom', 'own_rows_insert', 'insert', null, 'auth.uid() = user_id'),
    ('workout_sessions_custom', 'own_rows_update', 'update', 'auth.uid() = user_id', 'auth.uid() = user_id'),
    ('workout_sessions_custom', 'own_rows_delete', 'delete', 'auth.uid() = user_id', null)
  ) as v(tbl, name, cmd, using_, check_)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tbl and policyname = p.name) then
      execute format('create policy %I on public.%I for %s', p.name, p.tbl, p.cmd)
        || coalesce(' using (' || p.using_ || ')', '')
        || coalesce(' with check (' || p.check_ || ')', '');
    end if;
  end loop;
end $$;

-- Progress photos: a private bucket, each person's files under their own id.
-- Uploading is 20261019100000_trial_accounts.sql's policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'select own progress photos') then
    create policy "select own progress photos" on storage.objects for select
      using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'delete own progress photos') then
    create policy "delete own progress photos" on storage.objects for delete
      using (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = (auth.uid())::text);
  end if;
end $$;

commit;
