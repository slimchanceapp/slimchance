// Adaptive (learned) TDEE.
//
// The formula TDEE in `tdee.ts` (Mifflin-St Jeor x an activity guess) is only a
// STARTING estimate. Real maintenance varies a lot person-to-person and drifts
// during a cut — metabolic adaptation, an activity multiplier that's just a
// guess, and (for this user) GLP-1 appetite suppression all move the true
// number. Rather than trust the formula forever, we LEARN the real burn from
// the one identity that can't lie over time:
//
//   intake - TDEE = energy stored per day
//   energy stored per day ≈ weightChangeKgPerDay x 7700 kcal/kg
//   =>  TDEE ≈ meanDailyIntake - weightSlopeKgPerDay x 7700
//
// (weightSlopeKgPerDay is negative when losing, so it ADDS to intake — a person
//  eating 2000 and dropping 0.5 kg/wk is really burning ~2550.)
//
// This is only trustworthy when food logging is reasonably COMPLETE over the
// window (missing days bias intake low → TDEE low → a dangerous "eat even less"
// message). So we count only plausibly-logged days, gate on how many we have,
// and expose a confidence level the caller must respect. Pure + unit-tested.
//
// Confidence is the weight slope's own 95% interval, converted to kcal/day —
// not just a count of days. A ±1 kg scale over five weeks leaves the slope
// uncertain by ±0.4 kg/week, which is ±440 kcal/day of "learned burn": far too
// loose to steer a target with, however many days were logged. (Counting days
// alone once labelled four estimates between 1,736 and 2,732 kcal all "high".)

import { fitWeightLine, WINDOW_DAYS } from './insights.ts';

/** Standard energy density of body-mass change (~7700 kcal per kg). */
export const KCAL_PER_KG = 7700;

export interface AdaptiveTdeeInput {
  /** Per-day intake in kcal. Only pass days the user actually logged. */
  intake: Array<{ date: string; kcal: number }>;
  /** Body-weight measurements (kg). */
  weights: Array<{ date: string; weight: number }>;
  /** Trailing window to fit over, in days. Default: the trend window (35). */
  windowDays?: number;
  /** Below this a day is treated as "not really logged" and ignored. Default 800. */
  minLoggedKcal?: number;
  /** Days under this share of the usual logged day count as half-logged. Default PARTIAL_SHARE; 0 keeps them (evals). */
  partialShare?: number;
  /** Reference date (ISO) the window ends at. Default: latest data point / today. */
  asOf?: string;
}

export type TdeeConfidence = 'high' | 'medium' | 'low' | 'insufficient';

export interface AdaptiveTdee {
  /** Learned maintenance kcal/day. null when there isn't enough data. */
  tdee: number | null;
  confidence: TdeeConfidence;
  /** Number of plausibly-logged intake days used. */
  loggedDays: number;
  /** Mean of those logged days' intake — what the log usually says a day.
   *  null if none. */
  meanIntake: number | null;
  /** Weight-trend slope over the window, kg/week (negative = losing). */
  weightRateKgPerWeek: number;
  /** Days the weight regression spanned. */
  weightSpanDays: number;
  /** ± kcal/day on tdee, from the weight slope's 95% interval. null without a line. */
  uncertaintyKcal: number | null;
}

/** A logged day under this share of the person's usual day counts as half-logged. */
export const PARTIAL_SHARE = 0.55;
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** ± kcal/day of learned burn below which the estimate may steer a target. */
const HIGH_KCAL = 150;
const MEDIUM_KCAL = 300;

/**
 * Learn maintenance calories from logged intake + the weight trend over a
 * trailing window. Returns tdee=null (confidence 'insufficient') unless there's
 * enough complete-enough data to be trustworthy.
 */
export function adaptiveTdee(input: AdaptiveTdeeInput): AdaptiveTdee {
  const windowDays = input.windowDays ?? WINDOW_DAYS;
  const minKcal = input.minLoggedKcal ?? 800;

  const dates = [
    ...input.intake.map((i) => i.date),
    ...input.weights.map((w) => w.date),
  ].sort();
  const endMs = input.asOf
    ? new Date(`${input.asOf}T12:00:00`).getTime()
    : dates.length
      ? new Date(`${dates[dates.length - 1]}T12:00:00`).getTime()
      : Date.now();
  const cutoffMs = endMs - windowDays * 86400000;
  const inWindow = (d: string) => {
    const t = new Date(`${d}T12:00:00`).getTime();
    return t >= cutoffMs && t <= endMs;
  };

  // Only days with a plausible amount logged count — a blank or 200-kcal day is
  // missing data, not a genuine near-fast, and would drag the mean down.
  const plausible = input.intake.filter((i) => inWindow(i.date) && i.kcal >= minKcal);
  // A half-logged day (a forgotten dinner) passes that cut and teaches a burn
  // too low, the unsafe way. A day under 55% of the person's own usual day is
  // left out too: on 6,000 simulated people with their own day-to-day spread
  // (scripts/eval-partial.mjs, chapter 7) it cut budgets >200 kcal too low from
  // 14.1% to 9.9% with the bias near zero. Very variable eaters lose a few real
  // light days, which errs high (slower loss), never low.
  const usual = median(plausible.map((i) => i.kcal));
  const logged = plausible.filter((i) => i.kcal >= (input.partialShare ?? PARTIAL_SHARE) * usual);
  const line = fitWeightLine(input.weights, endMs, windowDays);
  const slope = line?.slopePerDay ?? 0;
  const span = line?.spanDays ?? 0;

  const base: AdaptiveTdee = {
    tdee: null,
    confidence: 'insufficient',
    loggedDays: logged.length,
    meanIntake: logged.length ? Math.round(logged.reduce((s, i) => s + i.kcal, 0) / logged.length) : null,
    weightRateKgPerWeek: +(-slope * 7).toFixed(2),
    weightSpanDays: span,
    uncertaintyKcal: line && line.n > 2 ? Math.round(line.halfWidthPerDay * KCAL_PER_KG) : null,
  };

  // Need a real weight span AND enough logged intake days to trust the identity.
  if (!line || span < 14 || logged.length < 10 || base.meanIntake == null) return base;

  // The MEAN logged intake, not the median: energy adds up. The median of a
  // week with a rhythm sits on the weekdays and ignores what the weekend adds —
  // on one real account (Sunday 2,850, Monday 1,820) it under-read intake, and
  // so the learned burn and every target built on it, by ~250 kcal a day.
  const meanIntake = logged.reduce((s, i) => s + i.kcal, 0) / logged.length;
  const tdee = Math.round(meanIntake - slope * KCAL_PER_KG);

  // Sanity clamp — a wildly out-of-range value means the data (usually
  // incomplete logging) can't be trusted; downgrade rather than mislead.
  if (tdee < 1200 || tdee > 5500) {
    return { ...base, confidence: 'insufficient' };
  }

  const u = base.uncertaintyKcal ?? Infinity;
  let confidence: TdeeConfidence;
  if (logged.length >= 21 && span >= 21 && u <= HIGH_KCAL) confidence = 'high';
  else if (logged.length >= 14 && span >= 14 && u <= MEDIUM_KCAL) confidence = 'medium';
  else confidence = 'low';

  return { ...base, tdee, confidence };
}

// ---------------------------------------------------------------------------
// The week's maintenance: the number this week's target is built on
// ---------------------------------------------------------------------------

/** How far each Sunday's fresh estimate moves the one targets are built on. */
const WEEKLY_ALPHA = 0.35;
/** Sundays the smoothing runs over. 0.65^12 < 1%: the oldest has no pull left. */
const SMOOTH_WEEKS = 12;
/** With no usable Sunday for longer than this, the smoothed number is stale. */
const STALE_WEEKS = 3;

export interface WeeklyMaintenance {
  /** Smoothed learned maintenance for this week; null means use the formula. */
  kcal: number | null;
  /** The fresh estimate as of last Sunday — logged days, rate, interval. */
  latest: AdaptiveTdee;
  /** The formula's maintenance sits outside the learned interval: this log and
   *  this scale rule it out, whatever the reason (food the log leaves out, an
   *  activity level that's a guess). */
  formulaRuledOut: boolean;
}

function shiftDays(ymdStr: string, days: number): string {
  const d = new Date(`${ymdStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Learned maintenance in the LOG'S OWN UNITS, re-estimated as of each Sunday
 * and smoothed, so a target set from it holds for the week and moves gently.
 *
 * A log that leaves the same things out every week — the oil in the curry, the
 * raisins on the tvaroh — still makes a good ruler: what it misses is missing
 * from the intake AND from the maintenance learned against the scale, so a
 * target in its units cancels it. Asking for every gram logged would ask for a
 * habit nobody keeps for a year. So a learned number is used when it is tight
 * enough to steer by, or when its interval already rules out the formula —
 * either way it beats a formula the scale has contradicted.
 *
 * One Sunday's estimate swings a few hundred kcal on a ±1 kg scale; feeding
 * that straight into the target would lurch it by up to 500 a week. Smoothed
 * (α 0.35), a closed-loop simulation moved it ~40 a week and tracked the true
 * number twice as closely — and never wound itself down to the floor.
 */
export function weeklyMaintenance(input: {
  intake: Array<{ date: string; kcal: number }>;
  weights: Array<{ date: string; weight: number }>;
  /** Monday of the current week. Estimates are as of the Sundays before it. */
  weekStart: string;
  /** The formula's maintenance at the current weight, when the profile allows. */
  formulaKcal: number | null;
}): WeeklyMaintenance {
  const usable = (e: AdaptiveTdee) => e.tdee != null && (
    e.confidence === 'high' || e.confidence === 'medium' ||
    (input.formulaKcal != null && e.uncertaintyKcal != null && Math.abs(input.formulaKcal - e.tdee) > e.uncertaintyKcal)
  );
  let smoothed: number | null = null;
  let age = Infinity;
  let latest: AdaptiveTdee | null = null;
  for (let k = SMOOTH_WEEKS - 1; k >= 0; k--) {
    const e = adaptiveTdee({ intake: input.intake, weights: input.weights, asOf: shiftDays(input.weekStart, -1 - 7 * k) });
    if (k === 0) latest = e;
    if (!usable(e)) { age++; continue; }
    smoothed = smoothed == null ? (e.tdee as number) : smoothed + WEEKLY_ALPHA * ((e.tdee as number) - smoothed);
    age = 0;
  }
  const l = latest as AdaptiveTdee;
  return {
    kcal: smoothed != null && age <= STALE_WEEKS ? Math.round(smoothed) : null,
    latest: l,
    formulaRuledOut: input.formulaKcal != null && l.tdee != null && l.uncertaintyKcal != null
      && Math.abs(input.formulaKcal - l.tdee) > l.uncertaintyKcal,
  };
}

/**
 * Daily intake to lose `kgPerWeek` at a known maintenance, floored so we never
 * recommend an unsafely low target even if the maths says so.
 */
export function targetIntakeForLoss(tdee: number, kgPerWeek: number, floorKcal = 1500): number {
  const dailyDeficit = (kgPerWeek * KCAL_PER_KG) / 7;
  return Math.max(floorKcal, Math.round(tdee - dailyDeficit));
}
