// What a watch adds to the scale (the owner, 2026-11-10: "use resting heart
// rate and NEAT too, for the overall health of that person"). Each signal gets
// its own honest trend over the last 5 weeks, from the same line fit as the
// weight trend (insights.fitWeightLine), and its own plain meaning. Not a
// health score: adding unlike signals into one number would invent a meaning.
// Today-against-your-normal is a different question, answered by readiness.ts.
// Pure; checked in selfcheck.js.

import { fitWeightLine } from './insights.ts';

export type SignalKind = 'resting_hr' | 'steps' | 'sleep_hours' | 'hrv';
export interface SignalTrend {
  kind: SignalKind;
  n: number;
  mean: number;
  perWeek: number;
  range: [number, number];
  direction: 'rising' | 'falling' | 'steady' | 'unclear';
  text: string;
}

// Change per week too small to matter in practice, per signal.
const BAND: Record<SignalKind, number> = { resting_hr: 0.5, steps: 300, sleep_hours: 0.1, hrv: 0.5 };
const DP: Record<SignalKind, number> = { resting_hr: 1, steps: 0, sleep_hours: 1, hrv: 1 };

const WORDS: Record<SignalKind, Record<SignalTrend['direction'], (x: number, m: number) => string>> = {
  resting_hr: {
    falling: (x) => `Resting heart rate is falling, about ${x} bpm a week: the usual sign of fitness improving.`,
    rising: (x) => `Resting heart rate is rising, about ${x} bpm a week. Short sleep, stress, illness or hard training can each do this; an easier day helps if it keeps climbing.`,
    steady: (_, m) => `Resting heart rate is steady, around ${m} bpm.`,
    unclear: () => 'Resting heart rate: too noisy to call a direction yet.',
  },
  steps: {
    falling: (x, m) => `Daily steps are falling, about ${x} a week (average ${m}). Moving less is a common hidden reason weight loss slows: the body saves energy when food is cut.`,
    rising: (x) => `Daily steps are rising, about ${x} a week: everyday movement counts.`,
    steady: (_, m) => `Daily steps are steady, around ${m}.`,
    unclear: () => 'Daily steps: too noisy to call a direction yet.',
  },
  sleep_hours: {
    falling: (x) => `Sleep is getting shorter, about ${x} h a week.`,
    rising: (x) => `Sleep is getting longer, about ${x} h a week.`,
    steady: (_, m) => `Sleep is steady, around ${m} h.`,
    unclear: () => 'Sleep: too noisy to call a direction yet.',
  },
  hrv: {
    falling: (x) => `HRV is trending down, about ${x} ms a week: often stress or too little recovery.`,
    rising: (x) => `HRV is trending up, about ${x} ms a week: recovering well.`,
    steady: (_, m) => `HRV is steady, around ${m} ms.`,
    unclear: () => 'HRV: too noisy to call a direction yet.',
  },
};

/** One signal's trend over the 5 weeks to asOf; null under 7 readings. */
export function signalTrend(kind: SignalKind, points: { date: string; value: number }[], asOfMs: number): SignalTrend | null {
  const pts = points.filter((p) => p.value > 0).map((p) => ({ date: p.date, weight: p.value }));
  const line = fitWeightLine(pts, asOfMs);
  if (!line || line.n < 7) return null;
  const used = pts.filter((p) => { const t = Date.parse(`${p.date}T12:00:00`); return t <= asOfMs + 86400000 && t >= asOfMs - 35 * 86400000; });
  const r = (x: number) => +x.toFixed(DP[kind]);
  const perWeek = line.slopePerDay * 7, half = line.halfWidthPerDay * 7, band = BAND[kind];
  const lo = perWeek - half, hi = perWeek + half;
  const direction = lo > 0 && perWeek >= band ? 'rising' : hi < 0 && perWeek <= -band ? 'falling'
    : lo > -band && hi < band ? 'steady' : 'unclear';
  const mean = r(used.reduce((s, p) => s + p.weight, 0) / used.length);
  let text = WORDS[kind][direction](Math.abs(r(perWeek)), mean);
  if (kind === 'sleep_hours' && mean < 6.5) text += ` Averaging ${mean} h; short sleep tends to raise appetite the next day.`;
  return { kind, n: line.n, mean, perWeek: r(perWeek), range: [r(lo), r(hi)], direction, text };
}

/** The one reading across signals worth saying: what the watch explains about the scale. */
export function together(chanceLoseIn10: number | null, s: Partial<Record<SignalKind, SignalTrend | null>>): string | null {
  if (chanceLoseIn10 != null && chanceLoseIn10 <= 3 && s.steps?.direction === 'falling')
    return 'Weight isn’t clearly coming off and steps are falling: moving less may be part of why.';
  if (chanceLoseIn10 != null && chanceLoseIn10 >= 8 && s.resting_hr?.direction === 'falling')
    return 'Weight coming off and resting heart rate falling: getting lighter and fitter together.';
  return null;
}
