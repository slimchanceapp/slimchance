/**
 * Insights that are allowed to say "I don't know yet".
 *
 * THE THESIS: weigh-in density is the binding constraint on every claim this
 * app wants to make. Body weight swings ±1-2 kg a day on water and gut content
 * alone, so with a handful of readings the scatter is larger than the signal —
 * and a verdict computed on top of that is a guess in a confident font.
 *
 * So the flagship insight states what is known, attaches the error bar, and
 * names the DATE it will know more. That earns more trust than a confident
 * verdict, and it manufactures the exact behaviour (weighing most mornings)
 * that unlocks every other insight downstream.
 *
 * Every function here returns `null` when its data gate is not met. Silence is
 * a valid, deliberate output: an insight that fires on three data points is
 * worse than no insight, because it teaches the user to distrust the ones that
 * are real.
 *
 * Pure — no Svelte, no Dexie, no Supabase — so it is all unit-tested in
 * selfcheck.js.
 */

export interface WeighIn {
  date: string; // YMD
  weight: number; // kg
}

/**
 * Two-sided 95% t quantiles by degrees of freedom.
 *
 * A lookup beats pulling in a stats library for one number, and beats the
 * normal approximation outright: at n=8 (df=6) the true multiplier is 2.45,
 * not 1.96 — using 1.96 would understate the error bar by 25% at exactly the
 * sample size where honesty matters most.
 */
const T95: Record<number, number> = {
  1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
  15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
  25: 2.060, 30: 2.042, 40: 2.021, 60: 2.000, 120: 1.980,
};

export function tCritical(df: number): number {
  if (df < 1) return T95[1];
  if (T95[df] != null) return T95[df];
  // Between tabulated points, take the next LOWER df — i.e. the wider, more
  // conservative interval. Erring toward "we're less sure" is the right
  // direction for a claim about someone's body.
  const keys = Object.keys(T95).map(Number).sort((a, b) => a - b);
  let best = 1.96;
  for (const k of keys) {
    if (k <= df) best = T95[k];
    else break;
  }
  return best;
}

/** Minimum weigh-ins before the residual scatter itself is meaningful. */
const MIN_WEIGHINS = 7;
/** Trailing window. Longer than this and a real change of pace gets averaged away. */
export const WINDOW_DAYS = 35;
/** Below this the rate is indistinguishable from maintaining, in practice. */
const RATE_FLOOR_KG_WK = 0.15;
/** Never promise an answer further out than this — past it, "log more" is the honest advice. */
const MAX_FORECAST_DAYS = 60;
/** How much one morning's water carries into the next, before a series can
 *  show its own. A week or two of slow water swings looks exactly like a trend,
 *  so a short series can't measure this; it starts high (the careful end of
 *  what scales do) and the person's own mornings take over as they add up.
 *  Chosen 2026-11-10 by calibration across nine kinds of scale (selfcheck). */
const CARRY_PRIOR = 0.7;
const CARRY_PRIOR_WEIGHT = 10;
/** A yes/no claim that a watch signal is changing (signals.ts, fitness.ts)
 *  assumes at least this much carry-over, the careful end: the estimate reads
 *  low until a series is long, and trusting it let a flat signal be called
 *  rising or falling up to 14% of the time (2026-11-10). */
export const CAREFUL_CARRY = 0.7;
/** Before the line says much, a true rate is assumed to lie near the line the
 *  chance is about, within about 0.4 kg a week: so no information is a coin
 *  toss, and a week of noise can't produce a verdict (2026-11-10). */
const RATE_PRIOR_SD = 0.4;

export type TrendState = 'not-enough' | 'too-noisy' | 'answerable';

export interface WeightVerdict {
  state: TrendState;
  /** kg/week. POSITIVE = losing, to match the rest of the app. */
  rateKgPerWeek: number;
  /** Half-width of the 95% interval on the rate, kg/week. */
  halfWidthKgPerWeek: number;
  /** The interval itself, in the same positive-is-losing convention. */
  loKgPerWeek: number;
  hiKgPerWeek: number;
  /** Residual scatter around the fitted line, kg. This is "how noisy is my scale". */
  scatterKg: number;
  /** Weigh-ins used. */
  n: number;
  /** Days spanned by those weigh-ins. */
  spanDays: number;
  /** Only when state is 'too-noisy': roughly how many more daily weigh-ins are needed. */
  weighInsNeeded: number | null;
  /** Only when state is 'too-noisy': days away, assuming near-daily weighing. */
  daysUntilAnswer: number | null;
  /** Where the fitted line says you are at the last weigh-in — the number to
   *  show instead of one morning's reading. null until there is a line. */
  trendKg: number | null;
  /** Before there's a trend: the average of the mornings in the window, the
   *  steadiest guess at where someone is (one morning is noise). */
  meanKg?: number | null;
  /** The most recent reading, any age. */
  latestKg: number | null;
}

/**
 * The ONE least-squares line through weigh-ins: the trend, the learned burn
 * and every verdict read their slope from here, so no two screens can fit the
 * same scale readings differently. null when no slope is defined.
 */
export interface WeightLine {
  n: number;
  /** kg/day; negative = losing. */
  slopePerDay: number;
  /** Half-width of the 95% interval on the slope, kg/day (0 when df < 1). */
  halfWidthPerDay: number;
  /** Residual scatter around the line, kg. */
  scatterKg: number;
  /** The line's value at the last weigh-in. */
  endKg: number;
  spanDays: number;
}

function inWindow(points: WeighIn[], asOfMs: number, windowDays: number) {
  const cutoff = asOfMs - windowDays * 86400000;
  return (points ?? [])
    .filter((p) => p && p.date && isFinite(p.weight) && p.weight > 0)
    .map((p) => ({ t: new Date(`${p.date}T12:00:00`).getTime(), w: p.weight }))
    .filter((p) => isFinite(p.t) && p.t >= cutoff && p.t <= asOfMs + 86400000)
    .sort((a, b) => a.t - b.t);
}

/** `minCarry`: the least carry-over to assume. A yes/no claim about a
 *  direction (signals.ts) assumes the careful end, 0.7, rather than trusting a
 *  carry-over estimate that reads low until a series is long. */
export function fitWeightLine(points: WeighIn[], asOfMs: number, windowDays = WINDOW_DAYS, minCarry = 0): WeightLine | null {
  const rows = inWindow(points, asOfMs, windowDays);
  const n = rows.length;
  if (n < 2) return null;
  const x = rows.map((r) => (r.t - rows[0].t) / 86400000);
  const y = rows.map((r) => r.w);
  const xbar = x.reduce((a, b) => a + b, 0) / n;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - xbar) ** 2;
    sxy += (x[i] - xbar) * (y[i] - ybar);
  }
  // Everything logged on one day: no slope is defined, and pretending otherwise
  // would divide by zero.
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  const resid = y.map((v, i) => v - (intercept + slope * x[i]));
  const sse = resid.reduce((a, r) => a + r * r, 0);
  const df = n - 2;
  const scatter = df > 0 ? Math.sqrt(sse / df) : 0;
  // A heavy morning tends to follow a heavy morning (water and gut content
  // carry over), so daily readings are not independent and the textbook error
  // bar is too narrow. The noise is modelled as carrying over from day to day
  // (AR(1) in days, gaps included): the carry-over starts at CARRY_PRIOR and
  // moves toward the residuals' own lag-1 correlation as mornings add up; the
  // noise level is the residuals' sum of squares over what that model expects
  // it to be (tr(MR)), and the slope's spread is then exact for that model.
  // Until 2026-11-10 the residuals alone set both, which made the first two
  // weeks' coins up to 3 coins too sure: a short series hides its own swings.
  let lag = 0;
  for (let i = 0; i < n - 1; i++) lag += resid[i] * resid[i + 1];
  const rhoHat = sse > 0 ? Math.max(0, lag / sse) : 0;
  const rho = Math.max(minCarry, Math.min(0.9, (Math.max(df, 0) * rhoHat + CARRY_PRIOR_WEIGHT * CARRY_PRIOR) / (Math.max(df, 0) + CARRY_PRIOR_WEIGHT)));
  const pow: number[] = [1];
  let sumR = 0, cRc = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const g = Math.round(Math.abs(x[i] - x[j]));
    while (pow.length <= g) pow.push(pow[pow.length - 1] * rho);
    sumR += pow[g]; cRc += (x[i] - xbar) * (x[j] - xbar) * pow[g];
  }
  const expected = n - (sumR / n + cRc / sxx);
  const seSlope = df > 0 ? Math.sqrt((sse / Math.max(expected, 0.5)) * cRc) / sxx : 0;
  return {
    n, slopePerDay: slope, halfWidthPerDay: tCritical(df) * seSlope, scatterKg: scatter,
    endKg: intercept + slope * x[n - 1], spanDays: Math.round(x[n - 1]),
  };
}

/**
 * Fit weight against time and report the rate WITH its uncertainty.
 *
 * A slope alone is not a verdict; this also says whether that slope is
 * distinguishable from zero. Those are very different claims, and the app
 * once made the first while implying the second.
 */
export function weightVerdict(points: WeighIn[], asOfMs?: number): WeightVerdict | null {
  if (!Array.isArray(points) || points.length === 0) return null;

  const now = asOfMs ?? Date.now();
  const valid = points.filter((p) => p && p.date && isFinite(p.weight) && p.weight > 0 && new Date(`${p.date}T12:00:00`).getTime() <= now + 86400000).sort((a, b) => a.date.localeCompare(b.date));
  const latestKg = valid.length ? valid[valid.length - 1].weight : null;
  const n = inWindow(points, now, WINDOW_DAYS).length;
  const line = n >= MIN_WEIGHINS ? fitWeightLine(points, now) : null;
  if (!line) {
    return {
      state: 'not-enough', rateKgPerWeek: 0, halfWidthKgPerWeek: 0,
      loKgPerWeek: 0, hiKgPerWeek: 0, scatterKg: 0, n,
      spanDays: n > 1 ? fitWeightLine(points, now)?.spanDays ?? 0 : 0,
      weighInsNeeded: Math.max(1, MIN_WEIGHINS - n), daysUntilAnswer: Math.max(1, MIN_WEIGHINS - n),
      trendKg: null, latestKg,
      meanKg: n ? +(inWindow(points, now, WINDOW_DAYS).reduce((s, p) => s + p.w, 0) / n).toFixed(1) : null,
    };
  }

  const rate = -line.slopePerDay * 7;          // positive = losing
  const halfWidth = line.halfWidthPerDay * 7;  // kg/week
  const scatter = line.scatterKg;
  const base = {
    rateKgPerWeek: rate, halfWidthKgPerWeek: halfWidth,
    loKgPerWeek: rate - halfWidth, hiKgPerWeek: rate + halfWidth,
    scatterKg: scatter, n, spanDays: line.spanDays,
    trendKg: +line.endKg.toFixed(1), latestKg,
  };

  // The interval excludes zero => the direction is real, not scale noise.
  if (halfWidth < Math.abs(rate)) {
    return { state: 'answerable', ...base, weighInsNeeded: null, daysUntilAnswer: null };
  }

  // Too noisy to call. Work out how many near-daily weigh-ins WOULD settle it.
  // For evenly spaced points, Σ(x-x̄)² = n(n²−1)/12, so the half-width shrinks
  // predictably with n and we can solve for the smallest n that clears the bar.
  const target = Math.max(Math.abs(rate), RATE_FLOOR_KG_WK);
  let needed: number | null = null;
  for (let k = n + 1; k <= n + MAX_FORECAST_DAYS; k++) {
    const sxxK = (k * (k * k - 1)) / 12;
    const hw = tCritical(k - 2) * (scatter / Math.sqrt(sxxK)) * 7;
    if (hw < target) { needed = k; break; }
  }

  return {
    state: 'too-noisy', ...base,
    weighInsNeeded: needed ? needed - n : null,
    daysUntilAnswer: needed ? Math.min(MAX_FORECAST_DAYS, needed - n) : null,
  };
}

/**
 * How likely it is that the trend is really going the goal's way, 0–1, read
 * from the verdict's own 95% interval. Losing means faster than
 * RATE_FLOOR_KG_WK, the pace the verdicts already treat as maintaining, so a
 * drift the stall check calls flat never reads as good odds; gaining is the
 * same the other way; holding means not climbing past it. The interval's edge
 * sits at 1.96, so the odds pass 97.5% exactly where the interval clears the
 * line. null until there is a line.
 */
// ponytail: a normal curve at the interval's own scale stands in for Student's
// t; from the first verdict (seven weigh-ins) they agree to within one coin in ten.
// The line's rate is combined with RATE_PRIOR_SD around the chance's own line,
// so with little information the chance stays near a coin toss; with a month
// of mornings the line outweighs it.
export function chanceOf(v: WeightVerdict | null, way: 'lose' | 'gain' | 'hold'): number | null {
  if (!v || v.state === 'not-enough') return null;
  const line = way === 'lose' ? RATE_FLOOR_KG_WK : -RATE_FLOOR_KG_WK;
  const se = v.halfWidthKgPerWeek / 1.96;
  let rate = v.rateKgPerWeek, spread = 0;
  if (se > 0) {
    const wLine = 1 / (se * se), wPrior = 1 / (RATE_PRIOR_SD * RATE_PRIOR_SD);
    rate = (v.rateKgPerWeek * wLine + line * wPrior) / (wLine + wPrior);
    spread = Math.sqrt(1 / (wLine + wPrior));
  }
  const above = spread > 0 ? normalCdf((rate - line) / spread) : rate > line ? 1 : rate < line ? 0 : 0.5;
  return way === 'gain' ? 1 - above : above;
}

/** Φ(z), Abramowitz & Stegun 7.1.26 (error under 1e-7). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Pace against the PLAN, not against zero — the question a cut actually asks.
 *
 * "Too noisy to tell if you're losing" and "you are not losing at the pace you
 * planned" are different claims, and the second is often already certain: a
 * flat month with a ±1 kg scale can't prove a small loss, but it can rule out
 * 0.6 kg a week. Each answer below is only given when the 95% interval
 * supports it; everything else is 'too-early'.
 *
 *   gaining  — the whole interval is weight going UP
 *   stalled  — ruled out the plan's pace, and the best estimate is ~flat
 *   slower   — ruled out the plan's pace, but genuinely losing
 *   faster   — losing well over 1.5× the plan and past ~1% of bodyweight a
 *              week (muscle is at risk)
 *   on-pace  — confirmed losing, and the plan's pace is still in the interval
 */
export type Pace = 'too-early' | 'gaining' | 'stalled' | 'slower' | 'on-pace' | 'faster';

export function paceVsPlan(v: WeightVerdict | null, planKgPerWeek: number | null, fastKgPerWeek: number | null = null): Pace {
  if (!v || v.state === 'not-enough') return 'too-early';
  if (v.hiKgPerWeek < 0) return 'gaining';
  if (planKgPerWeek == null || planKgPerWeek <= 0) return 'too-early';
  if (v.hiKgPerWeek < planKgPerWeek) {
    return v.loKgPerWeek <= 0 || v.rateKgPerWeek < RATE_FLOOR_KG_WK ? 'stalled' : 'slower';
  }
  // A gentle plan (one step under the usual can mean 0.2 kg a week) must not
  // make an ordinary half-kilo week "too fast": that also needs the body's own
  // limit, ~1% of bodyweight, when the caller knows it.
  if (v.loKgPerWeek > Math.max(planKgPerWeek * 1.5, fastKgPerWeek ?? 0)) return 'faster';
  if (v.loKgPerWeek > 0) return 'on-pace';
  return 'too-early';
}

// ---------------------------------------------------------------------------
// Protein on training days vs rest days
// ---------------------------------------------------------------------------

export interface ProteinByDayResult {
  liftDays: number;
  restDays: number;
  liftAvgG: number;
  restAvgG: number;
  /** restAvg − liftAvg. Positive means protein DROPS on training days. */
  gapG: number;
  /** target − liftAvg, i.e. how far short training days fall. */
  shortOfTargetG: number;
}

/** Days below this are abandoned logging, not a real intake — same gate adaptiveTdee uses. */
const MIN_LOGGED_KCAL = 800;

/**
 * Do they under-eat protein on the days their body is actually repairing?
 *
 * Deliberately keyed on hand-logged workout dates rather than watch sessions:
 * the lift log has months of history where activity_sessions has days. An
 * insight is only as old as its thinnest input.
 */
export function proteinByTrainingDay(
  foodByDate: Map<string, { protein: number; kcal: number }>,
  liftDates: Set<string>,
  proteinTargetG: number,
  opts: { minDaysEachSide?: number; minGapG?: number; minShortG?: number } = {}
): ProteinByDayResult | null {
  const minDays = opts.minDaysEachSide ?? 5;
  const minGap = opts.minGapG ?? 15;
  const minShort = opts.minShortG ?? 20;

  const lift: number[] = [];
  const rest: number[] = [];
  for (const [date, v] of foodByDate) {
    if (!v || v.kcal < MIN_LOGGED_KCAL) continue;
    (liftDates.has(date) ? lift : rest).push(v.protein);
  }
  if (lift.length < minDays || rest.length < minDays) return null;

  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const liftAvg = mean(lift);
  const restAvg = mean(rest);
  const gap = restAvg - liftAvg;
  const short = proteinTargetG - liftAvg;

  // Only worth saying if it is both a real gap AND actually costing them.
  if (gap < minGap || short < minShort) return null;

  return {
    liftDays: lift.length, restDays: rest.length,
    liftAvgG: Math.round(liftAvg), restAvgG: Math.round(restAvg),
    gapG: Math.round(gap), shortOfTargetG: Math.round(short),
  };
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

// ---------------------------------------------------------------------------
// Why the scale isn't moving
// ---------------------------------------------------------------------------

export interface StallClue { id: 'weekend' | 'training' | 'thin-days' | 'moving-less'; title: string; detail: string }

export interface StallDiagnosis {
  /** Average logged kcal on the days that count (≥ 800 kcal), over the trend
   *  window — the mean, because the weekend's extra is real energy. */
  avgKcal: number;
  loggedDays: number;
  /** The least this body burns just living (resting × 1.2), when known. */
  floorKcal: number | null;
  /** floor − average, when the log sits below the floor: what the log doesn't
   *  carry, at least. Fine while it's steady — the target is in the log's units. */
  missingAtLeastKcal: number | null;
  clues: StallClue[];
}

const med = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Only when the trend has ruled out the plan (stalled or gaining): the
 * arithmetic, then where the room is — from this person's own week.
 *
 * It does NOT ask for a more complete log. A log that leaves the oil out every
 * week is a consistent ruler, and the target is set in its units (see
 * weeklyMaintenance), so hunting the missing grams changes nothing but the
 * effort. What moves a stall is behaviour the log CAN see: a weekend that runs
 * well above the weekdays, training that dropped away, days only half logged
 * (those do wobble the ruler).
 */
export function diagnoseStall(input: {
  pace: string;
  intake: Map<string, { kcal: number; items: number }>;
  floorKcal: number | null;
  today: string;
  /** Days with a lifting log or ≥ 30 minutes of watch-recorded sport. */
  trainingDays?: Iterable<string>;
  /** The week's shape (week.ts) — the same numbers the "Your week" card shows. */
  shape?: { weekdayKcal: number; weekendKcal: number; weekendGap: number } | null;
  /** Daily steps' trend over the same weeks (signals.ts signalTrend), when a
   *  watch or phone counts them. */
  steps?: { direction: string; perWeek: number; mean: number } | null;
  windowDays?: number;
}): StallDiagnosis | null {
  if (input.pace !== 'stalled' && input.pace !== 'gaining') return null;
  const dayMs = 86400000;
  const win = input.windowDays ?? WINDOW_DAYS;
  const end = new Date(`${input.today}T12:00:00`).getTime();
  const between = (from: number, to: number) => (d: string) => {
    const t = new Date(`${d}T12:00:00`).getTime();
    return t <= end - from * dayMs && t > end - to * dayMs;
  };
  const inTrend = between(0, win);
  const days = [...input.intake].filter(([d, v]) => inTrend(d) && v.kcal >= 800);
  if (days.length < 10) return null;
  const avg = Math.round(days.reduce((t, [, v]) => t + v.kcal, 0) / days.length);

  const clues: StallClue[] = [];

  // 1. The weekend. Friday evening onwards is where most weeks are won or lost.
  //    Read off the week's shape, so this and the "Your week" card agree.
  const sh = input.shape;
  if (sh && sh.weekendGap >= 300) {
    clues.push({
      id: 'weekend', title: 'The weekend is where the room is',
      detail: `Friday to Sunday you log a median ${sh.weekendKcal.toLocaleString()} a day, Monday to Thursday ${sh.weekdayKcal.toLocaleString()} — ${sh.weekendGap.toLocaleString()} more, three days a week, before anything the weekend doesn't log. Meeting halfway saves ~${(Math.round((sh.weekendGap * 3) / 2 / 50) * 50).toLocaleString()} a week without touching a weekday.`,
    });
  }

  // 2. Training that dropped away: the burn falls with it, so the same food
  //    that was losing weight stops doing it.
  if (input.trainingDays) {
    const all = [...new Set(input.trainingDays)];
    const perWeek = (f: (d: string) => boolean) => (all.filter(f).length * 7) / win;
    const now = perWeek(inTrend), before = perWeek(between(win, 2 * win));
    if (before >= 1.5 && before - now >= 1) {
      clues.push({
        id: 'training', title: 'Less training, less burn',
        detail: `${before.toFixed(1)} training days a week in the five weeks before, ${now.toFixed(1)} in the last five. The burn dropped with them — that's why food that was losing weight stopped doing it. The target follows the burn down until training is back.`,
      });
    }
  }

  // 3. Moving less: when food is cut, everyday movement often drops without
  //    anyone deciding it, and the burn drops with it (2026-11-10, the owner:
  //    "use NEAT too"). Said only when the steps' own trend is sure of it.
  if (input.steps?.direction === 'falling') {
    const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
    clues.push({
      id: 'moving-less', title: 'Moving less than you were',
      detail: `Daily steps are falling, about ${fmt(Math.abs(input.steps.perWeek))} a week, to an average of ${fmt(input.steps.mean)} lately. When food is cut, the body often moves less without anyone noticing: a common hidden reason a loss slows. A daily walk is the easiest part to win back.`,
    });
  }

  // 4. Days that are only half there: they do wobble the ruler.
  const thin = [...input.intake].filter(([d, v]) => inTrend(d) && v.items > 0 && v.items <= 2 && v.kcal < avg * 0.6).length;
  if (thin >= 3) {
    clues.push({
      id: 'thin-days', title: 'Half-logged days?',
      detail: `${thin} days in the last five weeks have only one or two entries. Logging roughly is fine; logging some days and not others makes the ruler wobble.`,
    });
  }

  const missing = input.floorKcal != null && avg < input.floorKcal ? input.floorKcal - avg : null;
  return { avgKcal: avg, loggedDays: days.length, floorKcal: input.floorKcal, missingAtLeastKcal: missing, clues };
}
