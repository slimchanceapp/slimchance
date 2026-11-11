// TDEE (Total Daily Energy Expenditure) and deficit/surplus math --
// Mifflin-St Jeor formula (the current gold-standard BMR equation,
// more accurate than the older Harris-Benedict formula for most people).
// This exists so a "goal weight" is never just a bare number again: it
// comes with an actual calorie target and a realistic timeline attached.

import { KCAL_PER_KG } from './adaptiveTdee.ts';
import { wtShortU } from './units.ts';
import type { GoalDirection } from './body/index.ts';

export interface TdeeInput {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: 'male' | 'female';
  activityLevel: ActivityLevel;
  /** Optional measured/estimated body-fat % (incl. AI photo estimate). When
   *  present and plausible, BMR is computed from lean mass (Katch-McArdle),
   *  which is more personal than the weight-only Mifflin equation. */
  bodyFatPct?: number | null;
}

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,      // desk job, little/no exercise
  light: 1.375,        // light exercise 1-3 days/week
  moderate: 1.55,      // moderate exercise 3-5 days/week
  active: 1.725,       // hard exercise 6-7 days/week
  very_active: 1.9,    // very hard exercise + physical job
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (desk job, little exercise)',
  light: 'Light (exercise 1-3 days/week)',
  moderate: 'Moderate (exercise 3-5 days/week)',
  active: 'Active (hard exercise 6-7 days/week)',
  very_active: 'Very active (hard exercise + physical job)',
};

export function calcBmr({ weightKg, heightCm, age, gender, bodyFatPct }: Omit<TdeeInput, 'activityLevel'>): number {
  // Katch-McArdle when a body-fat % is known (a caliper/scale reading OR the
  // app's AI photo estimate): BMR = 370 + 21.6 × lean body mass (kg). Lean mass
  // is the real driver of resting burn, so two people at the same weight but
  // different composition get different numbers — which is the whole point of
  // logging body fat. Falls back to Mifflin-St Jeor when bf% is absent or
  // implausible, so nothing regresses for users without a reading.
  if (bodyFatPct != null && bodyFatPct >= 3 && bodyFatPct <= 60 && weightKg > 0) {
    const lbm = weightKg * (1 - bodyFatPct / 100);
    return Math.round(370 + 21.6 * lbm);
  }
  // Mifflin-St Jeor: BMR = 10W + 6.25H - 5A + (5 for men, -161 for women)
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === 'male' ? base + 5 : base - 161;
}

export function calcTdee(input: TdeeInput): number {
  return Math.round(calcBmr(input) * ACTIVITY_MULTIPLIERS[input.activityLevel]);
}

export type { GoalDirection };

export interface GoalProjection {
  targetKg: number;
  /** Which way the body has to move. Everything else reads off this. */
  direction: GoalDirection;
  /** Absolute kg between here and the goal, whichever way it points. */
  kgToChange: number;
  /** @deprecated Only ever non-zero when direction === 'lose'. Kept so an older
   *  caller that hasn't been updated reads 0 rather than a misleading number. */
  kgToLose: number;
  tdee: number;
  /** Signed: negative is a deficit, positive is a surplus, 0 is maintenance. */
  dailyEnergyDeltaKcal: number;
  /** @deprecated Use dailyEnergyDeltaKcal. Positive magnitude of a DEFICIT only. */
  dailyDeficitKcal: number;
  targetIntakeKcal: number;
  weeksToGoal: number;
}

/**
 * A moderate, sustainable deficit (~20% below TDEE, capped at 750
 * kcal/day) targeting roughly 0.5-0.75kg/week loss -- fast enough to see
 * progress, conservative enough to preserve muscle during a recomp
 * (aggressive deficits risk losing the muscle mass being trained for).
 */
export function projectGoal(current: TdeeInput, targetKg: number): GoalProjection {
  const tdee = calcTdee(current);
  return projectGoalWithTdee(tdee, current.weightKg, targetKg);
}

/**
 * Same projection but from a KNOWN maintenance (e.g. the adaptive TDEE learned
 * from real intake+weight data) instead of the formula estimate — so the
 * calorie target self-corrects to what the body is actually doing.
 */
/** Inside this band of the goal, the job is to hold, not to chase. */
const MAINTAIN_BAND_KG = 0.5;

export function projectGoalWithTdee(tdee: number, currentKg: number, targetKg: number): GoalProjection {
  const gap = currentKg - targetKg; // positive = above goal
  const direction: GoalDirection =
    gap > MAINTAIN_BAND_KG ? 'lose' : gap < -MAINTAIN_BAND_KG ? 'gain' : 'maintain';
  const kgToChange = Math.abs(gap) <= MAINTAIN_BAND_KG ? 0 : Math.abs(gap);

  // THIS FUNCTION USED TO ONLY KNOW HOW TO CUT. kgToLose was max(0, gap), so a
  // goal ABOVE current weight produced 0 kg to change and 0 weeks — and then
  // subtracted a 20% deficit anyway. Someone recovering from illness, 58 kg and
  // told to reach 66 kg, was handed a 1,660 kcal target against a 2,075 kcal
  // maintenance: the app actively prescribed further weight loss to a person who
  // needed the opposite. That is the population a medication or clinical
  // integration brings, so direction is now first-class rather than assumed.
  let dailyEnergyDeltaKcal: number;
  if (direction === 'lose') {
    // ~20% below maintenance, capped — fast enough to see, slow enough to keep muscle.
    dailyEnergyDeltaKcal = -Math.min(750, Math.round(tdee * 0.2));
  } else if (direction === 'gain') {
    // A LEAN gain is a small surplus. Beyond roughly +0.5% bodyweight a week the
    // extra is mostly fat, so this stays deliberately modest — ~10% over
    // maintenance, capped at 500, which lands near 0.25-0.4 kg/week.
    dailyEnergyDeltaKcal = Math.min(500, Math.max(250, Math.round(tdee * 0.1)));
  } else {
    dailyEnergyDeltaKcal = 0;
  }

  const targetIntakeKcal = tdee + dailyEnergyDeltaKcal;
  const weeksToGoal =
    kgToChange > 0 && dailyEnergyDeltaKcal !== 0
      ? Math.ceil((kgToChange * KCAL_PER_KG) / (Math.abs(dailyEnergyDeltaKcal) * 7))
      : 0;

  return {
    targetKg,
    direction,
    kgToChange,
    kgToLose: direction === 'lose' ? kgToChange : 0,
    tdee,
    dailyEnergyDeltaKcal,
    dailyDeficitKcal: direction === 'lose' ? Math.abs(dailyEnergyDeltaKcal) : 0,
    targetIntakeKcal,
    weeksToGoal,
  };
}

/**
 * The projection as a sentence, in the right direction.
 *
 * Every caller used to write its own, and every one of them hardcoded a cut:
 * "Cut to 66 kg … (415 kcal deficit)" was shown verbatim to a user whose goal
 * was to GAIN eight kilos. Saying it once, here, is what stops that recurring
 * the next time a screen needs the same sentence.
 */
export function projectionSummary(proj: GoalProjection, proteinG?: number): string {
  const protein = proteinG ? ` Protein ~${proteinG} g/day${proj.direction === 'gain' ? ' to build with.' : ' to hold muscle.'}` : '';
  if (proj.direction === 'maintain') {
    return `Hold ${wtShortU(proj.targetKg)} — maintenance ~${proj.tdee} kcal, target intake ~${proj.targetIntakeKcal} kcal/day.${protein}`;
  }
  const verb = proj.direction === 'gain' ? 'Build up to' : 'Cut to';
  const swing = proj.direction === 'gain'
    ? `${Math.abs(proj.dailyEnergyDeltaKcal)} kcal surplus`
    : `${Math.abs(proj.dailyEnergyDeltaKcal)} kcal deficit`;
  return `${verb} ${wtShortU(proj.targetKg)} — maintenance ~${proj.tdee} kcal, target intake ~${proj.targetIntakeKcal} kcal/day (${swing}), ~${proj.weeksToGoal} weeks.${protein}`;
}

/**
 * The week's daily calorie target — recomputed as weight and learned burn change,
 * instead of the number frozen into goal_reason the day the goal was set.
 *
 * Priority:
 *   1. LEARNED maintenance (weeklyMaintenance: intake − weight-trend, in the
 *      log's own units, smoothed across Sundays). It already includes every
 *      calorie training burned — badminton, the gym, steps — so exercise is
 *      never added on top (that would double-count), and it falls naturally as
 *      bodyweight drops. Below the formula is fine: a log that leaves the oil
 *      out every week learns a maintenance with the oil left out, and a target
 *      in those units cancels it.
 *   2. FORMULA maintenance (Mifflin, or Katch-McArdle when a body-fat % is
 *      known) at the CURRENT weight.
 *   3. The stored target parsed from goal_reason, as a last resort.
 *
 * All three run through projectGoal(WithTdee), which is direction-aware: a user
 * whose goal is above their weight is put in a surplus, never told to eat less.
 * On a cut we additionally floor the target at a safe minimum.
 */
export type TargetBasis = 'learned' | 'formula' | 'stored' | 'none';

export interface LiveTargetInput {
  goalKg: number | null;
  currentWeightKg: number | null;
  /** Learned maintenance the target may be built on — null when it may not
   *  (weeklyMaintenance decides). */
  learnedTdee: number | null;
  profile: { heightCm: number; age: number; gender: 'male' | 'female'; activityLevel: ActivityLevel; bodyFatPct?: number | null } | null;
  storedTarget: number | null;
  /** This week's nudge from the Sunday check-in, kcal/day (one week only). */
  adjustKcal?: number;
  /** What the log usually says a day (median of the trend window's logged
   *  days). A cut never asks for more than one step below it in a week. */
  usualKcal?: number | null;
}

export interface LiveTargetResult {
  target: number | null;
  basis: TargetBasis;
  maintenance: number | null;
  direction: GoalDirection | null;
  /** The weekly change this target is built to produce, kg/week, POSITIVE =
   *  losing (the trend's convention). null when there is no maintenance. */
  planKgPerWeek: number | null;
  /** The check-in nudge inside `target`, kcal/day. */
  adjustKcal: number;
}

/**
 * The least a body can be burning: resting metabolism plus the bare minimum of
 * daily living (×1.2, the "sedentary" multiplier). A learned maintenance below
 * this isn't a slow metabolism — it's food the log doesn't carry.
 */
export function burnFloor(p: { weightKg: number; heightCm: number; age: number; gender: 'male' | 'female'; bodyFatPct?: number | null }): number {
  return Math.round(calcBmr(p) * 1.2);
}

/** Hard floors so a cut can never prescribe a dangerously low intake. */
export const CUT_FLOOR: Record<'male' | 'female', number> = { male: 1500, female: 1200 };

/**
 * The most a learned cut asks below what the log usually says, per week. When
 * the scale has run ahead of the log for a while the maths can land 500+ under
 * someone's usual day, and a number that far from their life gets ignored, not
 * followed. One step at a time: if the scale still won't move, the usual comes
 * down and so does next week's target.
 */
const STEP_KCAL = 300;

export function resolveCalorieTarget(i: LiveTargetInput): LiveTargetResult {
  const haveGoal = i.goalKg != null && i.currentWeightKg != null && i.currentWeightKg > 0;
  const adjust = i.adjustKcal ?? 0;
  const result = (projected: number, basis: TargetBasis, maintenance: number, direction: GoalDirection): LiveTargetResult => {
    const target = floorIfCut(projected + adjust, direction, i.profile?.gender);
    return { target, basis, maintenance, direction, planKgPerWeek: +(((maintenance - target) * 7) / KCAL_PER_KG).toFixed(2), adjustKcal: target - floorIfCut(projected, direction, i.profile?.gender) };
  };
  if (haveGoal) {
    if (i.learnedTdee != null) {
      const p = projectGoalWithTdee(i.learnedTdee, i.currentWeightKg as number, i.goalKg as number);
      // One step under the usual at most, and never above maintenance: a cut
      // that plans a gain isn't one.
      const step = p.direction === 'lose' && i.usualKcal ? Math.min(i.learnedTdee, Math.round((i.usualKcal - STEP_KCAL) / 50) * 50) : 0;
      return result(Math.max(p.targetIntakeKcal, step), 'learned', i.learnedTdee, p.direction);
    }
    if (i.profile) {
      const p = projectGoal({ weightKg: i.currentWeightKg as number, ...i.profile }, i.goalKg as number);
      return result(p.targetIntakeKcal, 'formula', p.tdee, p.direction);
    }
  }
  return { target: i.storedTarget, basis: i.storedTarget != null ? 'stored' : 'none', maintenance: null, direction: null, planKgPerWeek: null, adjustKcal: 0 };
}

function floorIfCut(target: number, direction: GoalDirection, gender?: 'male' | 'female'): number {
  if (direction !== 'lose') return target;
  return Math.max(target, CUT_FLOOR[gender ?? 'male']);
}
