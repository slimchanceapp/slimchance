// npm audit, at every ship: every high or critical advisory must be one we
// have read and accepted, with the reason and a date to look again, in
// scripts/audit-accepted.json. Moderate and low ones go on the backlog.
//   node scripts/audit-gate.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** The high and critical advisories in an `npm audit --json` report that
 *  nobody accepted, or whose acceptance has run past its date. */
export function gate(report, accepted, today) {
  const found = new Map();
  for (const v of Object.values(report.vulnerabilities ?? {})) {
    for (const x of v.via ?? []) {
      if (typeof x !== 'object' || !['high', 'critical'].includes(x.severity)) continue;
      const id = String(x.url ?? '').split('/').pop();
      const a = accepted[id];
      if (!a || !(today <= a.until)) found.set(id, { id, severity: x.severity, name: x.name, title: x.title ?? '', until: a?.until });
    }
  }
  return [...found.values()];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const accepted = JSON.parse(readFileSync(new URL('./audit-accepted.json', import.meta.url), 'utf8'));
  let out;
  // npm audit exits non-zero whenever it finds anything; the report is still on stdout.
  try { out = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 }); } catch (e) { out = e.stdout; }
  const report = JSON.parse(out);
  if (report.error) { console.error('audit-gate: npm audit failed:', report.error.summary ?? report.error); process.exit(1); }
  const today = new Date().toISOString().slice(0, 10);
  const fresh = gate(report, accepted, today);
  if (fresh.length) {
    console.error(`audit-gate: ${fresh.length} high or critical advisor${fresh.length === 1 ? 'y' : 'ies'} nobody has accepted:`);
    for (const f of fresh) console.error(`  ${f.severity} ${f.name} ${f.id}${f.until ? ` (accepted until ${f.until}, look again)` : ''}: ${f.title}`);
    console.error('Fix it, or accept it with the reason and a date in scripts/audit-accepted.json.');
    process.exit(1);
  }
  console.log(`audit-gate: no unread high or critical advisories (${Object.keys(accepted).filter((k) => k.startsWith('GHSA-')).length} accepted, scripts/audit-accepted.json).`);
}
