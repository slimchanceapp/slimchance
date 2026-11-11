// Partial days: does a day logged far below the person's own usual day bias the
// learned budget, and does a personal cut-off fix it? (Chapter 7: MacroFactor
// calls partial logging the most damaging input and detects it; we ignored only
// days under a fixed 800 kcal.)
//
// Simulated people with a known true burn, so every estimate can be scored:
// a true daily intake with day-to-day spread and a weekend lift; a log that
// always misses a share of each day (oil, extras: absorbed by design, "the log's
// own units"); days not logged at all; PARTIAL days (only part of the day
// logged, like a forgotten dinner); a scale with water that lingers (AR(1)) and
// missed mornings. Each rule's learned maintenance is compared with what a
// perfect log in the same units would have taught it.
//
//   node scripts/eval-partial.mjs [people=4000]      (SPREAD=0.16 for one shared spread)
// No network, no AI: pure maths, free to run.
//
// 2026-11-11, 6,000 people, each with their own spread: the fixed 800 cut left
// 14.1% of budgets more than 200 kcal too low (bias -24); 55% of the person's
// usual day 9.9% (bias +6); a perfect partial-day detector 8.5%. A cut at a
// share of the usual day was the only rule that came near it; one judged by
// the person's own spread (MAD) stayed near today's. src/lib/adaptiveTdee.ts
// uses 55%.
import { adaptiveTdee } from '../src/lib/adaptiveTdee.ts';

const N = Number(process.argv[2]) || 4000;
let seed = 20261111;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const U = (a, b) => a + (b - a) * rnd();
const DAYS = 63;
// Day-to-day spread of what is really eaten: one value for everyone, or 'mix'
// (each person their own, 8% to 35%, as diet-recall studies find people differ).
const SPREAD_ARG = process.env.SPREAD || 'mix';
const day = (k) => { const d = new Date(Date.UTC(2026, 8, 1 + k)); return d.toISOString().slice(0, 10); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

function keepAbove(logged, z) {
  const k = logged.map((d) => d.kcal), m = median(k);
  const sigma = 1.4826 * median(k.map((x) => Math.abs(x - m)));
  return logged.filter((d) => d.kcal >= Math.max(800, m - z * sigma));
}

function lenient(logged, share, z) {
  const k = logged.map((d) => d.kcal), m = median(k);
  const sigma = 1.4826 * median(k.map((x) => Math.abs(x - m)));
  return logged.filter((d) => d.kcal >= Math.max(800, Math.min(share * m, m - z * sigma)));
}

const RULES = {
  'fixed 800 kcal (today)': (logged) => logged.filter((d) => d.kcal >= 800),
  'personal: 50% of usual': (logged) => { const m = median(logged.map((d) => d.kcal)); return logged.filter((d) => d.kcal >= Math.max(800, 0.5 * m)); },
  'personal: 55% of usual': (logged) => { const m = median(logged.map((d) => d.kcal)); return logged.filter((d) => d.kcal >= Math.max(800, 0.55 * m)); },
  'personal: 60% of usual': (logged) => { const m = median(logged.map((d) => d.kcal)); return logged.filter((d) => d.kcal >= Math.max(800, 0.6 * m)); },
  'personal: 70% of usual': (logged) => { const m = median(logged.map((d) => d.kcal)); return logged.filter((d) => d.kcal >= Math.max(800, 0.7 * m)); },
  // Against the person's own spread: a day counts as half-logged only when it
  // sits far below their usual day for them (median absolute deviation, which
  // the partial days themselves can't drag much).
  'own spread: median - 2.0 MAD': (logged) => keepAbove(logged, 2.0),
  'own spread: median - 2.5 MAD': (logged) => keepAbove(logged, 2.5),
  'own spread: median - 3.0 MAD': (logged) => keepAbove(logged, 3.0),
  // The more lenient of the two per person: 60% of usual for steady eaters,
  // backing off to their own spread when their days genuinely vary.
  'lenient of 60% and 2 MAD': (logged) => lenient(logged, 0.6, 2.0),
  'lenient of 65% and 2 MAD': (logged) => lenient(logged, 0.65, 2.0),
  'oracle: true partial days removed': null,
};
const stats = Object.fromEntries(Object.keys(RULES).map((k) => [k, { err: [], tooLow: 0, n: 0 }]));
const byPartial = { none: {}, some: {}, many: {} };

for (let i = 0; i < N; i++) {
  const T = U(1800, 3000);                      // true burn
  const meanIntake = T - U(0, 700);             // eating at a deficit (or not)
  const u = U(0, 0.25);                         // share every log leaves out
  const f = U(0.55, 1);                         // chance a day is logged at all
  const p = [0, U(0.03, 0.12), U(0.15, 0.3)][Math.floor(rnd() * 3)]; // partial-day rate
  const phi = U(0.3, 0.8), sd = U(0.3, 1.0), miss = U(0, 0.4);
  const SPREAD = SPREAD_ARG === 'mix' ? U(0.08, 0.35) : Number(SPREAD_ARG);
  let w = U(70, 130), water = 0;
  const intake = [], weights = [], intakeOracle = [];
  let trueSum = 0;
  for (let k = 0; k < DAYS; k++) {
    const dow = (k + 1) % 7;                    // 1 Sep 2026 is a Tuesday
    const weekend = dow === 5 || dow === 6 || dow === 0 ? 1.12 : 0.95;
    const eaten = Math.max(600, meanIntake * weekend * (1 + SPREAD * gauss()));
    trueSum += eaten;
    if (rnd() < f) {
      const partial = rnd() < p;
      const share = partial ? U(0.25, 0.7) : 1;
      const kcal = Math.round(eaten * (1 - u) * share);
      intake.push({ date: day(k), kcal });
      if (!partial) intakeOracle.push({ date: day(k), kcal });
    }
    water = phi * water + Math.sqrt(1 - phi * phi) * sd * gauss();
    if (rnd() > miss) weights.push({ date: day(k), weight: +(w + water).toFixed(1) });
    w -= (T - eaten) / 7700;
  }
  // What a complete log in the same units would teach: the burn minus the share
  // the log always leaves out of a usual day. The target is set in those units.
  const ideal = T - u * (trueSum / DAYS);
  const asOf = day(DAYS - 1);
  const bucket = p === 0 ? 'none' : p < 0.13 ? 'some' : 'many';
  for (const [name, rule] of Object.entries(RULES)) {
    const used = rule ? rule(intake) : intakeOracle;
    const est = adaptiveTdee({ intake: used, weights, asOf, minLoggedKcal: 0, partialShare: 0 });
    if (est.tdee == null || est.confidence === 'insufficient' || est.confidence === 'low') continue;
    const e = est.tdee - ideal;
    const s = stats[name]; s.err.push(e); s.n++; if (e < -200) s.tooLow++;
    ((byPartial[bucket][name] ||= []).push(e));
  }
}

const fmt = (x) => (x >= 0 ? '+' : '') + Math.round(x);
console.log(`${N} simulated people, ${DAYS} days each; estimates with at least medium confidence\n`);
console.log('rule'.padEnd(36), 'used', '  bias', '  typical error', '  >200 kcal too low');
for (const [name, s] of Object.entries(stats)) {
  const bias = s.err.reduce((a, b) => a + b, 0) / s.n;
  const mae = s.err.reduce((a, b) => a + Math.abs(b), 0) / s.n;
  console.log(name.padEnd(36), String(s.n).padStart(4), fmt(bias).padStart(6), String(Math.round(mae)).padStart(10) + ' kcal', `${(100 * s.tooLow / s.n).toFixed(1)}%`.padStart(14));
}
console.log('\nbias by how often days are half-logged (kcal/day):');
for (const [b, rules] of Object.entries(byPartial)) {
  console.log(`  ${b.padEnd(5)}`, Object.entries(rules).map(([n, e]) => `${n.split(':')[0].split(' (')[0]} ${fmt(e.reduce((a, c) => a + c, 0) / e.length)}`).join(' | '));
}
