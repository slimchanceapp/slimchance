// What a watch adds to the scale (the owner, 2026-11-10: "use resting heart
// rate and NEAT too, for the overall health of that person"). Each signal gets
// its own honest trend over the last 5 weeks, from the same line fit as the
// weight trend (insights.fitWeightLine), and its own plain meaning. Not a
// health score: adding unlike signals into one number would invent a meaning.
// Today-against-your-normal is a different question, answered by readiness.ts.
// Pure; checked in selfcheck.js.

import { fitWeightLine, CAREFUL_CARRY } from '../body/index.ts';

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
  // A direction is a yes/no claim, so it assumes the careful end of day-to-day
  // carry-over (0.7): measured 2026-11-10, trusting the estimate let a flat
  // signal be called rising or falling up to 14% of the time.
  const line = fitWeightLine(pts, asOfMs, undefined, CAREFUL_CARRY);
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

// ---------------------------------------------------------------------------
// Does the watch corroborate the training the verdict rests on?
// ---------------------------------------------------------------------------

export interface WatchAgreement {
  handLoggedDays: number;
  confirmedDays: number;
  /** Days the watch saw a strength session that was never hand-logged. */
  unloggedByHand: number;
}

/**
 * Cross-check hand-logged lifting against what the watch independently saw.
 *
 * This is the one claim in the app that two instruments can corroborate, which
 * is exactly what makes it worth showing. Deliberately type-agnostic on the
 * watch side: watches routinely label lifting as a generic workout, and
 * demanding an exact type match would manufacture disagreement.
 *
 * The copy built on this must never imply the user skipped training — an
 * unconfirmed day is overwhelmingly a watch on a charger.
 */
export function watchAgreement(
  handLoggedDates: Set<string>,
  watchSessions: { date: string; duration_min: number; kind?: string }[],
  opts: { minDurationMin?: number; minHandDays?: number } = {}
): WatchAgreement | null {
  const minDur = opts.minDurationMin ?? 20;
  const minHand = opts.minHandDays ?? 3;

  if (!watchSessions.length) return null;      // no instrument, not a failure
  if (handLoggedDates.size < minHand) return null;

  const watchDates = new Set(
    watchSessions.filter((s) => (s.duration_min ?? 0) >= minDur).map((s) => s.date)
  );
  let confirmed = 0;
  for (const d of handLoggedDates) if (watchDates.has(d)) confirmed++;

  let unlogged = 0;
  for (const s of watchSessions) {
    if (s.kind === 'strength' && !handLoggedDates.has(s.date)) unlogged++;
  }

  return {
    handLoggedDays: handLoggedDates.size,
    confirmedDays: confirmed,
    unloggedByHand: unlogged,
  };
}

// ---------------------------------------------------------------------------
// What the heaviest sessions cost the next morning
// ---------------------------------------------------------------------------

export interface RecoveryCost {
  pairs: number;
  heavyRhr: number;
  lightRhr: number;
  deltaBpm: number;
  heavyTonnageKg: number;
  lightTonnageKg: number;
}

/**
 * Split training days at their median tonnage and compare next-morning resting
 * HR. Rides biometrics (the densest table the app owns) against the lift log.
 *
 * Never phrased as proof of causation in the UI: alcohol, illness and a warm
 * room all move resting HR and the app cannot see any of them.
 */
export function recoveryCost(
  tonnageByDate: Map<string, number>,
  rhrByDate: Map<string, { rhr: number; sleptHours: number | null }>,
  nextDay: (ymd: string) => string,
  opts: { minPairs?: number; minPerBucket?: number; minDeltaBpm?: number } = {}
): RecoveryCost | null {
  const minPairs = opts.minPairs ?? 8;
  const minPerBucket = opts.minPerBucket ?? 4;
  const minDelta = opts.minDeltaBpm ?? 3;

  const pairs: { ton: number; rhr: number }[] = [];
  for (const [date, ton] of tonnageByDate) {
    if (!(ton > 0)) continue;
    const nxt = rhrByDate.get(nextDay(date));
    // Requiring sleep too is how we know the watch was actually WORN overnight;
    // a resting HR with no sleep beside it is usually a stray daytime reading.
    if (!nxt || nxt.rhr == null || nxt.sleptHours == null) continue;
    pairs.push({ ton, rhr: nxt.rhr });
  }
  if (pairs.length < minPairs) return null;

  const sorted = [...pairs].sort((a, b) => a.ton - b.ton);
  const mid = Math.floor(sorted.length / 2);
  const light = sorted.slice(0, mid);
  const heavy = sorted.slice(sorted.length % 2 === 1 ? mid + 1 : mid);
  if (light.length < minPerBucket || heavy.length < minPerBucket) return null;

  const mean = (a: { rhr: number }[]) => a.reduce((s, x) => s + x.rhr, 0) / a.length;
  const meanTon = (a: { ton: number }[]) => a.reduce((s, x) => s + x.ton, 0) / a.length;
  const hR = mean(heavy), lR = mean(light);
  const delta = hR - lR;

  // The buckets must actually differ in load, or this is measuring nothing.
  const hT = meanTon(heavy), lT = meanTon(light);
  if (lT <= 0 || (hT - lT) / lT < 0.2) return null;
  if (delta < minDelta) return null;

  return {
    pairs: pairs.length,
    heavyRhr: Math.round(hR), lightRhr: Math.round(lR),
    deltaBpm: Math.round(delta),
    heavyTonnageKg: Math.round(hT), lightTonnageKg: Math.round(lT),
  };
}
