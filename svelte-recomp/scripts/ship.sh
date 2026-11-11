#!/bin/sh
# The only way the web app goes live (ENGINEERING.md): a committed, pushed
# commit that passes the whole baseline, deployed with that commit as its
# version, then checked on every live address, and rolled back on its own if
# the check fails.
set -eu
cd "$(dirname "$0")/.."
fail() { echo "ship: $*" >&2; exit 1; }

[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "commit your changes first."
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "HEAD is not origin/main: push (or pull) first."

npm run verify
# Any dependency, build tools included (SvelteKit's runtime ships from devDependencies).
npm audit --audit-level=high >/dev/null || fail "npm audit found a high or critical vulnerability: run npm audit, fix it, then ship."
[ -z "$(git status --porcelain --untracked-files=no)" ] || fail "verify changed tracked files (the baseline grew?): commit and push them, then ship again."

SHA=$(git rev-parse --short=12 HEAD)
set -a; . ~/.config/recompos/vercel.env; set +a
PREV=$(vercel inspect svelte-recomp.vercel.app --token "$VERCEL_TOKEN" 2>&1 | awk '$1 == "id" { print $2; exit }')
[ -n "$PREV" ] || fail "can't tell which deployment is live now, so there'd be nothing to roll back to."

OUT=$(vercel --prod --yes --token "$VERCEL_TOKEN" --build-env APP_VERSION="$SHA")
NEW=$(printf '%s' "$OUT" | node -e 'let t="";process.stdin.on("data",(c)=>t+=c).on("end",()=>{const i=t.indexOf("\n{");const d=JSON.parse(i<0?t:t.slice(i+1));process.stdout.write(d.deployment?.id??"")})')
[ -n "$NEW" ] || fail "the deploy didn't report a deployment."

# A deploy after a rollback isn't given the addresses until it's promoted.
node scripts/smoke.mjs "$SHA" || { vercel promote "$NEW" --yes --token "$VERCEL_TOKEN" >/dev/null && node scripts/smoke.mjs "$SHA"; } || {
  echo "ship: the live check failed; rolling back to $PREV." >&2
  vercel rollback "$PREV" --yes --token "$VERCEL_TOKEN"
  exit 1
}
echo "ship: $SHA is live on every address and checked."
