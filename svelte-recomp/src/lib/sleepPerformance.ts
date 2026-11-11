// Sleep → performance correlation.
//
// The app logs sleep (biometrics.sleep_hours) and every training set, but never
// connected them. The single most motivating cross-signal in a recomp is "when
// I sleep, I train harder" — because it turns an abstract habit into a lever you
// can feel. This splits your days by sleep and compares what you actually did in
// the gym, and reports a plain correlation, only when there's enough paired data
// to mean something.
//
// Pure — no Svelte/Dexie — unit-tested in selfcheck.js.

import type { StrengthLog } from './training/index';

export interface SleepNight { date: string; sleep_hours?: number | null }

export interface SleepPerfReport {
  pairedDays: number;              // days with both sleep + training logged
  avgTonnageGoodSleep: number | null;  // >= goodH hours
  avgTonnagePoorSleep: number | null;  // <  poorH hours
  liftDaysGoodSleep: number;
  liftDaysPoorSleep: number;
  correlation: number | null;      // Pearson r between sleep hours and day tonnage
  headline: string | null;
}

/** Daily training tonnage = sum of reps × load over working sets. */
function tonnageByDate(logs: StrengthLog[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const log of logs) {
    let t = 0;
    for (const s of log.sets || []) {
      if (s.reps != null && s.weight_kg != null && s.reps > 0 && s.weight_kg > 0) t += s.reps * s.weight_kg;
    }
    if (t > 0) m.set(log.date, (m.get(log.date) || 0) + t);
  }
  return m;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.round((num / Math.sqrt(dx * dy)) * 100) / 100;
}

export function sleepPerformance(
  sleep: SleepNight[],
  logs: StrengthLog[],
  opts: { goodH?: number; poorH?: number; minPaired?: number } = {},
): SleepPerfReport {
  const goodH = opts.goodH ?? 7;
  const poorH = opts.poorH ?? 6;
  const minPaired = opts.minPaired ?? 6;

  const sleepByDate = new Map<string, number>();
  for (const s of sleep) if (s.sleep_hours != null && s.sleep_hours > 0) sleepByDate.set(s.date, s.sleep_hours);
  const tonnage = tonnageByDate(logs);

  const xs: number[] = [], ys: number[] = [];
  let goodSum = 0, goodN = 0, poorSum = 0, poorN = 0;
  for (const [date, hrs] of sleepByDate) {
    const t = tonnage.get(date);
    if (t == null) continue; // only paired training days
    xs.push(hrs); ys.push(t);
    if (hrs >= goodH) { goodSum += t; goodN++; }
    else if (hrs < poorH) { poorSum += t; poorN++; }
  }

  const pairedDays = xs.length;
  const avgTonnageGoodSleep = goodN ? Math.round(goodSum / goodN) : null;
  const avgTonnagePoorSleep = poorN ? Math.round(poorSum / poorN) : null;
  const correlation = pearson(xs, ys);

  let headline: string | null = null;
  if (pairedDays < minPaired) {
    headline = null;
  } else if (avgTonnageGoodSleep != null && avgTonnagePoorSleep != null && poorN >= 2 && goodN >= 2) {
    const diffPct = Math.round(((avgTonnageGoodSleep - avgTonnagePoorSleep) / avgTonnagePoorSleep) * 100);
    if (diffPct >= 8) headline = `You lift ~${diffPct}% more volume after ${goodH}+ h sleep than under ${poorH} h. Sleep is training.`;
    else if (diffPct <= -8) headline = `Odd: your volume is higher on short sleep — likely a scheduling quirk, not a real effect.`;
    else headline = `Sleep and training volume track loosely here (${diffPct >= 0 ? '+' : ''}${diffPct}%). Keep logging both.`;
  } else if (correlation != null) {
    headline = correlation >= 0.3 ? `Positive link between sleep and gym output (r=${correlation}).`
      : correlation <= -0.3 ? `Weak inverse link (r=${correlation}) — probably noise so far.`
      : `No strong sleep–performance link yet (r=${correlation}).`;
  }

  return { pairedDays, avgTonnageGoodSleep, avgTonnagePoorSleep, liftDaysGoodSleep: goodN, liftDaysPoorSleep: poorN, correlation, headline };
}
