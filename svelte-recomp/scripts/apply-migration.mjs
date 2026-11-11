// Apply migration files to the Slim Chance project through the Management API
// (the CLI here can't reach the database without its password), record each
// version in supabase_migrations.schema_migrations, then check nothing drifted:
//   set -a; . ~/.config/recompos/supabase.env; set +a
//   node scripts/apply-migration.mjs ../supabase/migrations/<file>.sql
//   sh scripts/replay-migrations.sh --drift      (must say "drift: none")
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const REF = process.env.SUPABASE_PROJECT_REF, TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (REF !== 'jerbhsasccvjelkkphgu') { console.error('wrong project ref'); process.exit(1); }
const api = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  return { status: r.status, body: await r.text() };
};
for (const path of process.argv.slice(2)) {
  const f = basename(path, '.sql');
  const m = f.match(/^(\d{14})_([a-z0-9_]+)$/);
  if (!m) { console.error(`not a migration name: ${f}`); process.exit(1); }
  const r = await api(readFileSync(path, 'utf8'));
  console.log(f, r.status, r.body.slice(0, 200));
  if (r.status >= 300) process.exit(1);
  const rec = await api(`insert into supabase_migrations.schema_migrations (version, name) select '${m[1]}', '${m[2]}' where not exists (select 1 from supabase_migrations.schema_migrations where version = '${m[1]}')`);
  console.log('  recorded', m[1], rec.status, rec.body.slice(0, 120));
}
