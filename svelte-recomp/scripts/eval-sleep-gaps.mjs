// How long people lie awake between two pieces of a night, from real sleep logs
// (health/sleep.ts NIGHT_GAP_MIN). Data: the Fitbit study (Furberg et al. 2016,
// zenodo.org/records/53894, mturkfitbit_export_4.12.16-5.12.16.zip), file
// minuteSleep_merged.csv: one row a minute, logId = one recorded sleep, local time.
//   node scripts/eval-sleep-gaps.mjs path/to/minuteSleep_merged.csv
// 2026-11-11: 24 people, 459 logs; wakes inside the night (21:00-09:00) 2.0-2.6 h,
// the next gaps up 3.1 and 3.3 h, both midday naps.
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
const at = (s) => { const [d, t, ap] = s.split(' '); const [m, day, y] = d.split('/'); let [h, mi] = t.split(':').map(Number);
  h = (h % 12) + (ap === 'PM' ? 12 : 0); return new Date(Date.UTC(+y, m - 1, +day, h, mi)); };
const logs = new Map();
for (const [id, date, , logId] of rows) {
  const t = +at(date), k = `${id}:${logId}`, L = logs.get(k) ?? { id, start: t, end: t };
  L.start = Math.min(L.start, t); L.end = Math.max(L.end, t + 60e3); logs.set(k, L);
}
const byPerson = Map.groupBy([...logs.values()], (L) => L.id);
const night = (ms) => { const h = new Date(ms).getUTCHours(); return h >= 21 || h < 9; };
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
const gaps = [];
for (const L of byPerson.values()) {
  L.sort((a, b) => a.start - b.start);
  for (let i = 1; i < L.length; i++) gaps.push({ h: (L[i].start - L[i - 1].end) / 36e5, a: L[i - 1], b: L[i] });
}
console.log(`${byPerson.size} people, ${logs.size} sleep logs, ${gaps.length} gaps`);
for (const [lo, hi] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 6], [6, Infinity]]) {
  const g = gaps.filter((x) => x.h > lo && x.h <= hi);
  console.log(`${lo}-${hi} h: ${g.length} gaps, ${g.filter((x) => night(x.a.end) && night(x.b.start)).length} inside the night`);
}
for (const x of gaps.filter((x) => x.h > 2 && x.h <= 4).sort((p, q) => p.h - q.h)) {
  console.log(`  ${x.h.toFixed(1)} h awake: ${hhmm(x.a.start)}-${hhmm(x.a.end)} then ${hhmm(x.b.start)}-${hhmm(x.b.end)}`);
}
