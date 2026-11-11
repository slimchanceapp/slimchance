#!/bin/sh
# Every migration, replayed on an empty database: proof the repo can rebuild
# its own backend (self-hosting, and recovery from the repo alone). Until
# 2026-11-11 it couldn't: seven tables had been made by hand.
#
# A throwaway container of Supabase's own Postgres image (the version
# production runs), stubs for what Supabase's storage service creates, then
# each migration in order, stopping at the first error. Nothing outside the
# container is touched, and it is removed at the end.
#
#   sh scripts/replay-migrations.sh           replay only (CI runs this)
#   sh scripts/replay-migrations.sh --drift   also compare with production,
#       read-only through the Management API (~/.config/recompos/supabase.env)
set -eu
IMAGE=public.ecr.aws/supabase/postgres:17.6.1.134
NAME="slimchance-replay-$$"
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/../../supabase/migrations"

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=unused-local-only "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
sql() { docker exec -i "$NAME" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
for _ in $(seq 1 90); do
  [ "$(sql -Atc "select count(*) from pg_roles where rolname = 'authenticated'" 2>/dev/null || true)" = 1 ] && break
  sleep 2
done

# What Supabase's storage and auth services create, as much as the migrations need. Made
# as the image's admin (who owns the storage schema) and handed to postgres,
# which runs the migrations, as on the hosted project.
docker exec -i "$NAME" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid,
  metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $f$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
-- And what Supabase's auth service adds to the image's auth schema.
create or replace function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$f$;
SQL

n=0
for f in $(ls ./*.sql | sort); do
  if ! out=$(sql < "$f" 2>&1); then
    echo "replay: $(basename "$f") failed on an empty database:" >&2
    printf '%s\n' "$out" | grep -m3 -E 'ERROR|FATAL' >&2
    exit 1
  fi
  n=$((n + 1))
done
echo "replay: all $n migrations ran on an empty database."

[ "${1:-}" = "--drift" ] || exit 0

# The schema as lines, the same query on both sides: what each side would
# enforce, not the order it was built in. No row of anyone's data is read.
SCHEMA=$(cat "$HERE/schema-lines.sql")
sql -Atc "$SCHEMA" | sort > "/tmp/replay-local-$$.txt"
set -a; . "$HOME/.config/recompos/supabase.env"; set +a
[ "$SUPABASE_PROJECT_REF" = "jerbhsasccvjelkkphgu" ] || { echo "replay: wrong project ref" >&2; exit 1; }
node -e '
  const q = require("fs").readFileSync(process.argv[1], "utf8");
  fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, read_only: true }),
  }).then((r) => r.json()).then((rows) => { if (!Array.isArray(rows)) { console.error(JSON.stringify(rows).slice(0, 300)); process.exit(1); } for (const r of rows) console.log(r.line); });
' "$HERE/schema-lines.sql" | sort > "/tmp/replay-prod-$$.txt"
if diff -u "/tmp/replay-prod-$$.txt" "/tmp/replay-local-$$.txt" > "/tmp/replay-diff-$$.txt"; then
  echo "drift: none. The migrations rebuild exactly what production enforces ($(wc -l < "/tmp/replay-prod-$$.txt") lines compared)."
  rm -f /tmp/replay-*-$$.txt
else
  echo "drift: production (-) and the replayed migrations (+) differ:"
  grep -E '^[-+][^-+]' "/tmp/replay-diff-$$.txt"
  rm -f /tmp/replay-*-$$.txt
  exit 1
fi
