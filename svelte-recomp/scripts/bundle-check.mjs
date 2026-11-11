// The JavaScript a phone downloads, against its budget (scripts/bundle-budget.json):
// all of it, and what the first screen needs before it can draw (the start
// entry, the app, the layout and Today, with every chunk they import). Moving
// code between areas (decision 0006) must never make a phone download more.
// Over budget fails verify. A deliberate increase raises the budget in the same
// commit, with the reason, like baseline.txt; a decrease lowers it on its own.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';

const OUT = '.svelte-kit/output/client';
const BUDGET = 'scripts/bundle-budget.json';
const SLACK = 1.01; // 1%: a few bytes move with every build

const m = JSON.parse(readFileSync(`${OUT}/.vite/manifest.json`, 'utf8'));
const size = (f) => statSync(`${OUT}/${f}`).size;
const total = readdirSync(`${OUT}/_app/immutable`, { recursive: true })
  .filter((f) => f.endsWith('.js')).reduce((s, f) => s + size(`_app/immutable/${f}`), 0);
const FIRST = ['node_modules/@sveltejs/kit/src/runtime/client/entry.js', '.svelte-kit/generated/client-optimized/app.js',
  '.svelte-kit/generated/client-optimized/nodes/0.js', '.svelte-kit/generated/client-optimized/nodes/2.js'];
const files = new Set();
const walk = (k) => { const e = m[k]; if (!e || files.has(e.file)) return; files.add(e.file); for (const i of e.imports ?? []) walk(i); };
for (const k of FIRST) { if (!m[k]) { console.error(`bundle-check: ${k} is not in the build; update FIRST`); process.exit(1); } walk(k); }
const first = [...files].reduce((s, f) => s + size(f), 0);

const now = { total, first };
const budget = JSON.parse(readFileSync(BUDGET, 'utf8'));
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let over = false, lower = false;
for (const k of ['total', 'first']) {
  if (now[k] > budget[k] * SLACK) { over = true; console.error(`bundle-check: ${k} JavaScript is ${kb(now[k])}, over its budget of ${kb(budget[k])}. Find what grew, or raise the budget in ${BUDGET} with the reason in the commit.`); }
  else if (now[k] < budget[k]) lower = true;
}
if (over) process.exit(1);
if (lower) writeFileSync(BUDGET, JSON.stringify({ total: Math.min(now.total, budget.total), first: Math.min(now.first, budget.first) }, null, 2) + '\n');
console.log(`bundle-check: ${kb(total)} in all, ${kb(first)} for the first screen (budget ${kb(budget.total)}, ${kb(budget.first)}).`);
