// Supabase's security advisor, at every ship: every finding must be one we
// have read and accepted, with the reason, in scripts/advisor-accepted.json.
// A new SECURITY DEFINER function anyone can call, a table without row-level
// security, a new kind of warning: ship stops until someone looks.
//   set -a; . ~/.config/recompos/supabase.env; set +a; node scripts/advisors.mjs
import { readFileSync } from 'node:fs';

const REF = process.env.SUPABASE_PROJECT_REF, TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (REF !== 'jerbhsasccvjelkkphgu') { console.error('advisors: wrong project ref'); process.exit(1); }
const accepted = JSON.parse(readFileSync(new URL('./advisor-accepted.json', import.meta.url), 'utf8'));

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/advisors/security`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30_000) });
if (!r.ok) { console.error(`advisors: the advisor answered ${r.status}`); process.exit(1); }
const lints = (await r.json()).lints ?? [];

const where = (l) => `${l.metadata?.schema ?? ''}.${l.metadata?.name ?? l.metadata?.entity ?? ''}`;
const fresh = lints.filter((l) => {
  const rule = accepted[l.name];
  return !rule || !(rule.any || (rule.only ?? []).includes(where(l)));
});
if (fresh.length) {
  console.error(`advisors: ${fresh.length} finding${fresh.length === 1 ? '' : 's'} nobody has accepted:`);
  for (const l of fresh) console.error(`  ${l.level} ${l.name} on ${where(l)}: ${l.description ?? ''}\n    ${l.remediation ?? ''}`);
  console.error('Fix it, or accept it with the reason in scripts/advisor-accepted.json.');
  process.exit(1);
}
console.log(`advisors: ${lints.length} findings, all read and accepted (scripts/advisor-accepted.json).`);
