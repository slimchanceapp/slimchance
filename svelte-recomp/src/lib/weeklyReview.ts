// Weekly Review — a WHOOP/Oura-style end-of-week digest built entirely from data
// the app already stores. One place that answers "how did this week actually
// go, and what should I change next week?" by aggregating weight, intake vs
// LEARNED maintenance, protein, training tonnage, steps and sleep — then turning
// the gaps into concrete, prioritised adjustments. Pure + unit-tested.

import type { StrengthLog, StrengthSet } from './training/index';
import { weightVerdict } from './body/index.ts';
import { dwt } from './units.ts';

export interface WeeklyReviewInput {
  today: string; // YYYY-MM-DD
  weights: Array<{ date: string; weight: number }>;
  /** Combined per-day intake (itemised food + quick-logged kcal), protein in g. */
  intake: Array<{ date: string; kcal: number; protein: number }>;
  steps: Array<{ date: string; count: number }>;
  sleep: Array<{ date: string; sleep_hours: number | null }>;
  workouts: StrengthLog[];
  /** Every day trained, by the one definition (trainedDates): a session marked
   *  done, 25 watch minutes, or typed sets. */
  trained: Set<string>;
  learnedTdee: number | null;
  proteinTargetG: number;
  goalKg: number | null;
}

export interface WeeklyReview {
  weekStart: string;
  weekEnd: string;
  weightChangeKg: number | null;
  avgIntake: number | null;
  intakeDays: number;
  avgProtein: number | null;
  proteinDaysMet: number;
  proteinDaysLogged: number;
  avgSteps: number | null;
  stepDays: number;
  avgSleep: number | null;
  sleepDays: number;
  sessions: number;
  tonnageKg: number;
  tonnageDeltaPct: number | null;
  /** Estimated deficit/surplus vs learned maintenance (kcal/day). null if unknown. */
  energyBalance: number | null;
  headline: string;
  wins: string[];
  adjustments: string[];
}

function daysAgoYmd(today: string, n: number): string {
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday (YYYY-MM-DD) of the week containing `today`. Weeks start Monday; Sunday belongs to the week just ended. */
function mondayOfYmd(today: string): string {
  const day = new Date(today + 'T00:00:00').getDay();
  const back = day === 0 ? 6 : day - 1;
  return daysAgoYmd(today, back);
}

const avg = (ns: number[]): number | null => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : null);

/** A set counts as "real" once it carries both a rep count and a load. */
function isRealSet(s: StrengthSet): boolean {
  return s.reps != null && s.weight_kg != null && s.reps > 0 && s.weight_kg > 0;
}

/** Total volume load (Σ reps × weight) across every set in the given logs. */
function tonnage(logs: StrengthLog[]): number {
  let t = 0;
  for (const l of logs) {
    for (const s of l.sets || []) {
      if (isRealSet(s)) t += (s.reps as number) * (s.weight_kg as number);
    }
  }
  return t;
}

/**
 * Build the review for the current calendar week [Monday .. today], comparing
 * training tonnage against the prior full week [prev-Monday .. prev-Sunday].
 * Weeks start Monday (local convention).
 */
export function weeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const weekEnd = input.today;
  const weekStart = mondayOfYmd(input.today);
  const priorStart = daysAgoYmd(weekStart, 7);

  const inWeek = (d: string) => d >= weekStart && d <= weekEnd;
  const inPrior = (d: string) => d >= priorStart && d < weekStart;

  // — Weight change across the week: the TREND's, as of the week's end. First
  //   vs last reading of one week is mostly water — it once called a flat
  //   month's weeks −1.9 and +1.4 kg and listed the first as a win.
  const trend = weightVerdict(input.weights, new Date(`${weekEnd}T12:00:00`).getTime());
  const weightChangeKg = trend && trend.state !== 'not-enough' ? +(-trend.rateKgPerWeek).toFixed(1) : null;

  // — Intake + protein (only days actually logged) —
  const iWeek = input.intake.filter((i) => inWeek(i.date) && i.kcal > 0);
  const avgIntake = iWeek.length ? Math.round(avg(iWeek.map((i) => i.kcal))!) : null;
  const proteinDays = iWeek.filter((i) => i.protein > 0);
  const avgProtein = proteinDays.length ? Math.round(avg(proteinDays.map((i) => i.protein))!) : null;
  const proteinDaysMet = proteinDays.filter((i) => i.protein >= input.proteinTargetG * 0.9).length;

  // — Steps + sleep —
  const sWeek = input.steps.filter((s) => inWeek(s.date) && s.count > 0);
  const avgSteps = sWeek.length ? Math.round(avg(sWeek.map((s) => s.count))!) : null;
  const slWeek = input.sleep.filter((s) => inWeek(s.date) && s.sleep_hours != null && s.sleep_hours > 0);
  const avgSleep = slWeek.length ? +avg(slWeek.map((s) => s.sleep_hours as number))!.toFixed(1) : null;

  // — Training —
  const wkWorkouts = input.workouts.filter((w) => inWeek(w.date));
  // Training days, the watch's included: a gym session recorded on a watch
  // with no sets typed in is training all the same. Tonnage stays the typed sets'.
  const sessionDates = new Set([...input.trained].filter(inWeek));
  const tonnageKg = Math.round(tonnage(wkWorkouts));
  const priorTonnage = Math.round(tonnage(input.workouts.filter((w) => inPrior(w.date))));
  const tonnageDeltaPct = priorTonnage > 0 ? Math.round(((tonnageKg - priorTonnage) / priorTonnage) * 100) : null;

  // — Energy balance vs learned maintenance —
  const energyBalance =
    input.learnedTdee != null && avgIntake != null ? avgIntake - input.learnedTdee : null;

  const wins: string[] = [];
  const adjustments: string[] = [];

  if (weightChangeKg != null && weightChangeKg < -0.1) wins.push(`Trend down ${dwt(weightChangeKg)} this week.`);
  if (avgProtein != null && avgProtein >= input.proteinTargetG * 0.9) wins.push(`Protein averaged ${avgProtein} g/day — right on target.`);
  if (tonnageDeltaPct != null && tonnageDeltaPct >= 3) wins.push(`Training volume up ${tonnageDeltaPct}% vs last week — progressive overload is working.`);
  if (avgSteps != null && avgSteps >= 8000) wins.push(`${avgSteps.toLocaleString()} steps/day average — strong NEAT.`);
  if (avgSleep != null && avgSleep >= 7.5) wins.push(`Averaged ${avgSleep} h sleep — recovery well supported.`);

  // Adjustments, prioritised worst-first.
  // Never "log more": the budget works in the log's own units, and the card
  // already says how many days its average covers (the owner's rule; the
  // personas found this one, 2026-10-30).
  if (avgProtein != null && avgProtein < input.proteinTargetG * 0.9) {
    adjustments.push(`Raise protein: averaged ${avgProtein} g vs a ${input.proteinTargetG} g target. Add a protein source to the meal you most often skip it at.`);
  }
  if (weightChangeKg != null && weightChangeKg > 0.2 && (input.goalKg == null || (trend?.trendKg ?? trend?.latestKg ?? 0) > input.goalKg)) {
    adjustments.push('The trend ticked up this week. If it holds, trim ~200 kcal/day or tighten weekend logging.');
  } else if (weightChangeKg != null && Math.abs(weightChangeKg) <= 0.1 && (input.goalKg == null || (trend?.trendKg ?? trend?.latestKg ?? 0) > input.goalKg)) {
    adjustments.push('Weight was flat — if you are still above goal, change one lever for 10-14 days: −200 kcal/day or +2,000 steps.');
  }
  if (tonnageDeltaPct != null && tonnageDeltaPct <= -10) {
    adjustments.push(`Training volume dropped ${Math.abs(tonnageDeltaPct)}%. In a deficit that risks muscle — aim to at least match last week's top sets.`);
  }
  if (sessionDates.size < 2) {
    adjustments.push(`Only ${sessionDates.size} training day${sessionDates.size === 1 ? '' : 's'} this week. Resistance training is what tells your body to keep muscle while it burns fat.`);
  }
  if (avgSleep != null && avgSleep < 7) {
    adjustments.push(`Sleep averaged ${avgSleep} h. Short sleep spikes hunger and blunts recovery — protect a consistent lights-out time.`);
  }

  const headline = buildHeadline({ weightChangeKg, energyBalance, wins, adjustments, intakeDays: iWeek.length });

  return {
    weekStart, weekEnd,
    weightChangeKg,
    avgIntake, intakeDays: iWeek.length,
    avgProtein, proteinDaysMet, proteinDaysLogged: proteinDays.length,
    avgSteps, stepDays: sWeek.length,
    avgSleep, sleepDays: slWeek.length,
    sessions: sessionDates.size,
    tonnageKg, tonnageDeltaPct,
    energyBalance,
    headline, wins, adjustments,
  };
}

function buildHeadline(x: {
  weightChangeKg: number | null; energyBalance: number | null;
  wins: string[]; adjustments: string[]; intakeDays: number;
}): string {
  if (x.intakeDays === 0 && x.weightChangeKg == null) return 'Not much logged this week yet — a few weigh-ins and food logs unlock the full review.';
  if (x.weightChangeKg != null && x.weightChangeKg < -0.1 && x.adjustments.length === 0) {
    return 'A clean week: fat coming off with the fundamentals in place. Repeat it.';
  }
  if (x.weightChangeKg != null && x.weightChangeKg < -0.1) {
    return 'Solid week of progress — a couple of tweaks below will make next week even better.';
  }
  if (x.weightChangeKg != null && x.weightChangeKg > 0.2) {
    return 'The scale went the wrong way this week. The adjustments below are where to start.';
  }
  return 'A steady week — the adjustments below are the fastest way to get it moving again.';
}
