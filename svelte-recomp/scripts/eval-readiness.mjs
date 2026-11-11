// Readiness: does "how hard to train today" catch real strain without crying
// wolf on ordinary mornings? (Chapter 7: Oura learns each person's normal before
// it judges and reads trends against it; HRV-guided training in sports science
// judges a morning against the person's own normal range, because HRV swings
// 10-20% a day with nothing wrong.)
//
// Simulated people, each with their own normal HRV, resting heart rate, sleep
// need and day-to-day spread, and now and then a strained spell of 2 to 4 days
// (illness, overreaching): HRV lower, resting heart rate higher, sleep shorter.
// Every morning is scored: an "easy day" on an ordinary morning is a false
// alarm; on a strained morning it's a catch.
//
//   node scripts/eval-readiness.mjs [people=3000]
// No network, no AI: pure maths, free to run.
//
// 2026-11-11: the old score (14-day average, 8 h of sleep as the target) called
// 0.0% of strained mornings an easy day and 0.1% even moderate; the person's own
// range calls 55% easy and 87% at least moderate, with 1.0% of ordinary
// mornings called easy. src/lib/readiness.ts readyToday uses readyFromNormal.
//
// 2026-11-11: without HRV (the owner's watch has never sent one) the rule
// could never say "easy day": 0% of strained mornings. Resting heart rate 2 SD
// over normal, or 1.5 SD with a night an hour short, now decides it. Across
// strain effects of +3 to +7 bpm and -0.3 to -1 h of sleep it catches 22-51%,
// with 1.1-2.0% of ordinary mornings called easy (stricter rules caught half).
import { computeReadiness, readyFromNormal } from '../src/lib/readiness.ts';

const N = Number(process.argv[2]) || 3000;
let seed = 20261111;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const U = (a, b) => a + (b - a) * rnd();
const DAYS = 120, SCORE_FROM = 30;
const day = (k) => new Date(Date.UTC(2026, 6, 1 + k)).toISOString().slice(0, 10);

const tally = {};
const add = (method, strained, word) => {
  const t = (tally[method] ||= { normal: 0, normalEasy: 0, normalCalm: 0, strained: 0, strainedEasy: 0, strainedCalm: 0 });
  const easy = word === 'Low', calm = word === 'Low' || word === 'Fair';
  if (strained) { t.strained++; if (easy) t.strainedEasy++; if (calm) t.strainedCalm++; }
  else { t.normal++; if (easy) t.normalEasy++; if (calm) t.normalCalm++; }
};

for (let i = 0; i < N; i++) {
  const lnHrv = U(3.2, 4.4), sdHrv = U(0.05, 0.14);      // RMSSD about 25-80 ms, own daily spread
  const rhr0 = U(48, 75), sdRhr = U(1.5, 3.5);
  const need = U(6.2, 8.5), sdSleep = U(0.5, 1.1);
  const strain = new Array(DAYS).fill(0);
  for (let k = 0; k < DAYS; k++) if (rnd() < 1 / 30) { const len = 2 + Math.floor(rnd() * 3); const depth = U(0.6, 1.4); for (let j = k; j < Math.min(DAYS, k + len); j++) strain[j] = depth; }
  const rows = [];
  for (let k = 0; k < DAYS; k++) {
    const s = strain[k];
    if (rnd() < 0.1) continue;                            // a night the watch missed
    rows.push({
      date: day(k),
      hrv: Math.round(Math.exp(lnHrv - 0.22 * s + sdHrv * gauss())),
      resting_hr: Math.round(rhr0 + 5 * s + sdRhr * gauss()),
      sleep_hours: +Math.max(3, need - 0.6 * s + sdSleep * gauss()).toFixed(1),
      strained: s > 0,
    });
  }
  for (const r of rows) {
    const k = Math.round((Date.parse(r.date) - Date.parse(day(0))) / 864e5);
    if (k < SCORE_FROM) continue;
    const before = (n) => rows.filter((x) => x.date < r.date && x.date >= day(k - n));
    add('old: 14-day average, 8 h sleep', r.strained, computeReadiness(r, before(14))?.label);
    add('own normal range (60 days)', r.strained, readyFromNormal(r, before(60))?.word);
    // The same mornings from a watch that never shares HRV (most Samsung ones).
    const noHrv = (x) => ({ ...x, hrv: null });
    add('own normal range, no HRV', r.strained, readyFromNormal(noHrv(r), before(60).map(noHrv))?.word);
  }
}

const pct = (a, b) => `${(100 * a / b).toFixed(1)}%`.padStart(7);
console.log(`${N} simulated people, ${DAYS - SCORE_FROM} scored mornings each\n`);
console.log('method'.padEnd(36), '"easy day" on ordinary mornings', ' caught strained', '  calm-or-easy ordinary', ' calm-or-easy strained');
for (const [m, t] of Object.entries(tally)) {
  console.log(m.padEnd(36), pct(t.normalEasy, t.normal).padStart(31), pct(t.strainedEasy, t.strained).padStart(16), pct(t.normalCalm, t.normal).padStart(23), pct(t.strainedCalm, t.strained).padStart(22));
}
