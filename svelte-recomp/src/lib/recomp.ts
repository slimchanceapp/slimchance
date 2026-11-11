// The recomposition verdict.
//
// This answers the only question the whole app exists to answer: **is the
// weight coming off fat, or muscle?** Every other screen shows an input —
// calories, sets, steps, sleep. None of them told you whether the plan is
// actually working, even though the data to say so was already in the database.
//
// Two independent lines of evidence, in order of strength:
//
//   1. MEASURED composition. If body-fat percentage has been logged at least
//      twice, lean mass = weight × (1 − bf/100) is directly computable, and the
//      split of the weight change into fat vs lean follows. Nothing beats this.
//   2. INFERRED composition. Otherwise, pair the weight trend with the lift
//      log: strength holding or climbing while weight falls is the accepted
//      practical proxy for muscle retention, because a muscle that is being
//      lost does not keep producing the same force.
//
// The rule the verdict is built on: in a well-run deficit, roughly 75%+ of the
// weight lost should be fat. Lose much more lean than that and the cut is too
// aggressive, protein is too low, or the training stimulus is missing.
//
// Pure — no Svelte, Dexie or Capacitor — so it is unit-tested in selfcheck.js.

import type { StrengthTrend } from './training/index';

export type RecompDirection =
  | 'recomp'        // fat down AND muscle up/held — the outcome we want
  | 'fat-loss'      // losing weight, muscle retained
  | 'muscle-risk'   // losing weight, but strength/lean mass falling with it
  | 'lean-gain'     // gaining weight, mostly lean
  | 'fat-gain'      // gaining weight, not lean
  | 'maintaining'   // weight and strength both flat
  | 'insufficient'; // not enough data to say anything honest

export type Confidence = 'high' | 'medium' | 'low';

export interface BodyFatPoint {
  date: string;
  /** Body-fat percentage, e.g. 32.4 */
  bfPct: number;
  /** Bodyweight on (or nearest to) that date, kg. */
  weightKg: number;
}

export interface RecompInput {
  /** kg/week from the regression trend; POSITIVE = losing. */
  weightRateKgPerWeek: number;
  /** Days the weight trend was fitted over. */
  trendSpanDays: number;
  currentWeightKg: number | null;
  /** Verdict from the lift log (see strength.ts). */
  strength?: StrengthTrend | null;
  /** Body-fat measurements paired with bodyweight, any order. */
  bodyFat?: BodyFatPoint[];
  /** Daily protein target in grams. */
  proteinTargetG?: number;
  /** Days in the last 14 that hit >=90% of the protein target. */
  proteinDaysHit?: number;
  /** Days in the last 14 with any food logged (adherence denominator). */
  proteinDaysLogged?: number;
  /** Resistance-training sessions in the last 14 days. */
  liftingSessions14?: number;
}

export interface Evidence {
  label: string;
  value: string;
  verdict: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface Composition {
  /** kg of FAT lost (positive) or gained (negative) over the span. */
  fatKg: number;
  /** kg of LEAN mass lost (positive) or gained (negative) over the span. */
  leanKg: number;
  spanDays: number;
  /** Share of total weight change that was fat, 0..1. null if weight barely moved. */
  fatShare: number | null;
}

export interface RecompResult {
  direction: RecompDirection;
  confidence: Confidence;
  /** Short, plain answer to "is this working?" */
  headline: string;
  /** Two or three sentences of honest interpretation. */
  detail: string;
  evidence: Evidence[];
  /** Concrete changes, most important first. Empty when nothing needs changing. */
  levers: string[];
  /** Measured fat/lean split, when body-fat data allows it. */
  composition: Composition | null;
}

/** Lean body mass in kg from weight and body-fat percentage. */
export function leanMass(weightKg: number, bfPct: number): number {
  return weightKg * (1 - bfPct / 100);
}

/** Fat mass in kg from weight and body-fat percentage. */
export function fatMass(weightKg: number, bfPct: number): number {
  return weightKg * (bfPct / 100);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000
  );
}

/**
 * Split the change between the earliest and latest body-fat measurements into
 * fat and lean. Needs two readings at least 21 days apart — body-composition
 * estimates carry a few percent of measurement noise, so over a shorter window
 * the noise swamps the signal and the answer would be invented, not measured.
 */
export function measuredComposition(points: BodyFatPoint[] | undefined): Composition | null {
  if (!points || points.length < 2) return null;
  const sorted = [...points]
    .filter((p) => p.bfPct > 0 && p.bfPct < 75 && p.weightKg > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const spanDays = daysBetween(first.date, last.date);
  if (spanDays < 21) return null;

  // Positive = lost.
  const fatKg = +(fatMass(first.weightKg, first.bfPct) - fatMass(last.weightKg, last.bfPct)).toFixed(2);
  const leanKg = +(leanMass(first.weightKg, first.bfPct) - leanMass(last.weightKg, last.bfPct)).toFixed(2);

  const totalChange = Math.abs(fatKg) + Math.abs(leanKg);
  // Below ~1kg of total movement this is measurement noise, not a real split.
  const fatShare = totalChange >= 1 ? +(Math.abs(fatKg) / totalChange).toFixed(3) : null;

  return { fatKg, leanKg, spanDays, fatShare };
}

/** Fraction of the last 14 days where protein actually landed. 0..1, or null. */
function proteinAdherence(i: RecompInput): number | null {
  const logged = i.proteinDaysLogged ?? 0;
  if (logged < 4) return null; // too little logging to judge
  return Math.min(1, (i.proteinDaysHit ?? 0) / logged);
}

/**
 * Build the verdict. Deliberately conservative: with thin data it returns
 * 'insufficient' and says what to log, rather than inventing a reassuring
 * answer. A fitness app that claims you're keeping muscle when it cannot know
 * is doing real harm — you'd keep cutting.
 */
export function recompVerdict(i: RecompInput): RecompResult {
  const evidence: Evidence[] = [];
  const levers: string[] = [];
  const composition = measuredComposition(i.bodyFat);
  const losing = i.weightRateKgPerWeek > 0.1;
  const gaining = i.weightRateKgPerWeek < -0.1;
  const rate = Math.abs(i.weightRateKgPerWeek);
  const st = i.strength;
  const strengthKnown = !!st && st.direction !== 'insufficient';

  // — Evidence: weight trend —
  if (i.trendSpanDays >= 14) {
    evidence.push({
      label: 'Weight trend',
      value: `${losing ? '−' : gaining ? '+' : '±'}${rate.toFixed(2)} kg/wk over ${Math.round(i.trendSpanDays)}d`,
      verdict: losing ? 'good' : gaining ? 'warn' : 'neutral'
    });
  } else {
    evidence.push({
      label: 'Weight trend',
      value: `only ${Math.round(i.trendSpanDays)}d of data`,
      verdict: 'neutral'
    });
  }

  // — Evidence: strength —
  if (strengthKnown) {
    evidence.push({
      label: 'Strength (e1RM)',
      value: `${st!.avgPct > 0 ? '+' : ''}${st!.avgPct}% over ${Math.round(st!.windowDays / 7)} wks`,
      verdict: st!.direction === 'up' ? 'good' : st!.direction === 'holding' ? 'good' : 'bad'
    });
  } else {
    evidence.push({ label: 'Strength (e1RM)', value: 'not enough logged lifts', verdict: 'neutral' });
  }

  // — Evidence: measured composition —
  if (composition && composition.fatShare != null) {
    const pct = Math.round(composition.fatShare * 100);
    evidence.push({
      label: 'Measured split',
      value: `${pct}% of the change was fat`,
      verdict: pct >= 75 ? 'good' : pct >= 55 ? 'warn' : 'bad'
    });
  }

  // — Evidence: protein —
  const adherence = proteinAdherence(i);
  if (adherence != null) {
    const pct = Math.round(adherence * 100);
    evidence.push({
      label: 'Protein target',
      value: `hit on ${pct}% of logged days`,
      verdict: pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'bad'
    });
    if (pct < 70) {
      levers.push(
        `Hit ${i.proteinTargetG ?? 'your'} g of protein more often — you're managing it on ${pct}% of days. Protein is the single biggest lever on whether the loss is fat or muscle.`
      );
    }
  }

  // — Evidence: lifting frequency —
  const lifts = i.liftingSessions14;
  if (lifts != null) {
    evidence.push({
      label: 'Lifting',
      value: `${lifts} sessions / 14 days`,
      verdict: lifts >= 6 ? 'good' : lifts >= 3 ? 'warn' : 'bad'
    });
    if (lifts < 4) {
      levers.push(
        'Lift at least 3×/week. Without the stimulus, a deficit takes muscle by default — training is what tells the body which tissue to keep.'
      );
    }
  }

  // — Rate check: too fast for the amount of fat available to lose —
  // ~1% of bodyweight per week is the usual ceiling for muscle-sparing loss;
  // people carrying more fat can safely run nearer 1.5%.
  if (i.currentWeightKg && losing) {
    const pctPerWeek = (rate / i.currentWeightKg) * 100;
    if (pctPerWeek > 1.5) {
      levers.push(
        `You're dropping ${pctPerWeek.toFixed(1)}% of bodyweight per week. Above ~1.5% the body starts taking the difference from muscle — eat a bit more and let training do the shaping.`
      );
    }
  }

  // ————————————————————————————————————————————————
  // The verdict itself. Measured composition wins when we have it.
  // ————————————————————————————————————————————————
  let direction: RecompDirection;
  let confidence: Confidence;
  let headline: string;
  let detail: string;

  if (composition && composition.fatShare != null) {
    const { fatKg, leanKg, spanDays, fatShare } = composition;
    const weeks = Math.round(spanDays / 7);
    confidence = spanDays >= 56 ? 'high' : 'medium';

    if (fatKg > 0 && leanKg <= 0) {
      direction = 'recomp';
      headline = 'Fat down, muscle up';
      detail = `Over ${weeks} weeks you've lost ${fatKg.toFixed(1)} kg of fat and GAINED ${Math.abs(leanKg).toFixed(1)} kg of lean mass. That is textbook recomposition and it is the hardest thing to do in a deficit — whatever you're doing, keep doing it.`;
    } else if (fatKg > 0 && fatShare >= 0.75) {
      direction = 'fat-loss';
      headline = 'Losing fat, keeping muscle';
      detail = `Over ${weeks} weeks you're down ${(fatKg + leanKg).toFixed(1)} kg, and ${Math.round(fatShare * 100)}% of that was fat (${fatKg.toFixed(1)} kg fat vs ${leanKg.toFixed(1)} kg lean). Anything at or above ~75% fat is a well-run cut.`;
    } else if (fatKg > 0) {
      direction = 'muscle-risk';
      headline = 'Losing muscle along with the fat';
      detail = `Over ${weeks} weeks, ${Math.round((1 - fatShare) * 100)}% of what you lost was lean mass (${leanKg.toFixed(1)} kg of ${(fatKg + leanKg).toFixed(1)} kg). That's more than a well-run cut should give up. The fix is not more discipline — it's more protein, more lifting, and a smaller deficit.`;
    } else if (leanKg < 0 && Math.abs(leanKg) > Math.abs(fatKg)) {
      direction = 'lean-gain';
      headline = 'Gaining, and gaining mostly lean';
      detail = `Over ${weeks} weeks you've added ${Math.abs(leanKg).toFixed(1)} kg of lean mass against ${Math.abs(fatKg).toFixed(1)} kg of fat. If muscle is the aim right now, this is a good ratio.`;
    } else {
      direction = 'fat-gain';
      headline = 'The gain is mostly fat';
      detail = `Over ${weeks} weeks fat mass rose ${Math.abs(fatKg).toFixed(1)} kg while lean mass moved ${leanKg <= 0 ? '+' : '−'}${Math.abs(leanKg).toFixed(1)} kg. Pull calories back toward maintenance and keep the training where it is.`;
    }

    if (direction === 'muscle-risk') {
      levers.unshift('Shrink the deficit by ~200–300 kcal/day for two weeks and see whether strength recovers.');
    }
    return { direction, confidence, headline, detail, evidence, levers, composition };
  }

  // — No measured composition: infer from weight × strength —
  if (i.trendSpanDays < 14) {
    return {
      direction: 'insufficient',
      confidence: 'low',
      headline: 'Not enough data yet',
      detail:
        'A verdict needs at least two weeks of weigh-ins. Log your weight most mornings — the daily number is noise, but two weeks of dots is a trend that can actually be read.',
      evidence,
      levers: ['Weigh in most mornings for two weeks.', 'Log your lifts so strength can be compared over time.'],
      composition: null
    };
  }

  if (!strengthKnown) {
    return {
      direction: 'insufficient',
      confidence: 'low',
      headline: losing ? 'Losing weight — but of what?' : 'Can\'t tell fat from muscle yet',
      detail: losing
        ? `You're losing ${rate.toFixed(2)} kg/week, which is the easy half of the question. Whether that's fat or muscle can't be answered without evidence: log your working sets so strength can be tracked, or record body fat twice a month.`
        : 'Weight alone cannot separate fat from muscle. Log your lifts, or take a body-fat measurement every couple of weeks.',
      evidence,
      levers: [
        'Log weight × reps on your main lifts — holding strength in a deficit is the practical proof muscle is staying.',
        'Add a body-fat measurement in Body & Goals now, and again in a month.'
      ],
      composition: null
    };
  }

  // Both weight trend and strength trend are known.
  confidence = i.trendSpanDays >= 28 && st!.comparableLifts >= 3 ? 'medium' : 'low';
  const strengthWord = st!.direction === 'up' ? 'climbing' : st!.direction === 'holding' ? 'holding' : 'falling';

  if (losing && st!.direction !== 'down') {
    direction = 'fat-loss';
    headline = 'On track — losing fat, holding muscle';
    detail = `Weight is down ${rate.toFixed(2)} kg/week and your lifts are ${strengthWord} (${st!.avgPct > 0 ? '+' : ''}${st!.avgPct}% e1RM across ${st!.comparableLifts} lifts). Strength that doesn't fall in a deficit is the practical signal that what's leaving is fat. Add a body-fat measurement to confirm it directly.`;
  } else if (losing) {
    direction = 'muscle-risk';
    headline = 'Muscle may be going with the fat';
    detail = `You're down ${rate.toFixed(2)} kg/week, but your lifts are falling (${st!.avgPct}% e1RM${st!.topMover ? `, ${st!.topMover.name} worst` : ''}). Strength dropping during a cut is the earliest warning that the deficit is eating muscle. Act on it now — lost muscle is far slower to rebuild than lost fat is to re-lose.`;
    levers.unshift(
      'Keep the weight on the bar and cut reps instead of load — heavy work is the signal that preserves muscle.',
      'Ease the deficit by ~200 kcal/day for two weeks and watch whether strength comes back.'
    );
  } else if (gaining && st!.direction === 'up') {
    direction = 'lean-gain';
    headline = 'Gaining — and it looks like muscle';
    detail = `Weight is up ${rate.toFixed(2)} kg/week with strength climbing ${st!.avgPct}%. If you're intentionally building, this is what it should look like. If you meant to be cutting, the calories have drifted.`;
  } else if (gaining) {
    direction = 'fat-gain';
    headline = 'Gaining without strength to show for it';
    detail = `Weight is up ${rate.toFixed(2)} kg/week and your lifts are ${strengthWord}. Weight gain that isn't matched by strength is fat. Tighten logging first — that's usually where the drift is hiding.`;
    levers.unshift('Log every day for one week, weekends included. Untracked weekends are the most common cause.');
  } else if (st!.direction === 'up') {
    direction = 'recomp';
    headline = 'Recomping — same weight, more muscle';
    detail = `The scale has barely moved but your lifts are up ${st!.avgPct}%. That combination means you're swapping fat for muscle at roughly equal weight. The scale is the wrong instrument for this — judge it by the mirror and the bar.`;
  } else {
    direction = 'maintaining';
    headline = 'Holding steady';
    detail = `Weight and strength are both flat. That's maintenance — fine if it's deliberate, a plateau if it isn't. To move again, change ONE thing for a fortnight: trim ~200 kcal, add ~2,000 steps, or add a set to your main lifts.`;
    levers.push('Pick one change and hold it for two weeks before judging it.');
  }

  return { direction, confidence, headline, detail, evidence, levers, composition: null };
}

/** Colour/severity for the headline, so the UI doesn't re-derive it. */
export function verdictTone(d: RecompDirection): 'good' | 'warn' | 'bad' | 'neutral' {
  switch (d) {
    case 'recomp':
    case 'fat-loss':
    case 'lean-gain':
      return 'good';
    case 'muscle-risk':
      return 'bad';
    case 'fat-gain':
      return 'warn';
    default:
      return 'neutral';
  }
}
