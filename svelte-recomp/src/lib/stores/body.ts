// The body's numbers, computed once for every screen: where the weight is (the
// trend, not one morning's reading), how fast it is moving against the plan,
// what the food log says the body burns, and the calorie and protein targets
// that follow from those.
//
// Today, Food, Progress, the weekly check-in, the review and the coach all read
// this. Before, each one recomputed its own — four weight slopes, five
// intake-by-date maps, three calorie targets — and they disagreed: one account
// was told "losing 1.5 kg a week, 11 weeks to goal" on Today while Progress
// called the same readings too noisy and the real eight-week trend was a gain.
//
// The calorie target is the WEEK's: set from data up to last Sunday, so it holds
// still for seven days and the week's budget is a number you can plan against.
import { trainedDates } from '$lib/health/exercise';
import { derived, type Readable } from 'svelte/store';
import { liveWeights, liveGoal, liveFoodLogs, liveDailyLogs, liveProfile, liveTracks, liveGoalReason, liveWorkoutLogs, liveActivitySessions, liveSessionCompletions, liveBiometrics, liveDailySteps } from './live';
import { todayDate } from './refresh';
import { weightVerdict, paceVsPlan, diagnoseStall, type WeightVerdict, type Pace, type StallDiagnosis } from '$lib/insights';
import { weeklyMaintenance, type AdaptiveTdee } from '$lib/adaptiveTdee';
import { resolveCalorieTarget, burnFloor, calcTdee, type LiveTargetResult, type ActivityLevel } from '$lib/tdee';
import { proteinTargetG, ageFrom } from '$lib/profile';
import { parseCalorieTarget } from '$lib/coach';
import { mondayOf, shiftYmd } from '$lib/date';
import { signalTrend } from '$lib/signals';
import { weekBudget, weekShape, type WeekBudget, type WeekShape } from '$lib/week';
import { LINE_MARGIN_KG, lineState, type LineState } from '$lib/line';
import { heldUnder, milestoneState, type MilestoneState } from '$lib/milestone';
import { pulse, type KeepInput, type Pulse } from '$lib/pulse';
import { programWeek } from '$lib/program';
import { explainUp, type UpExplained } from '$lib/scaleUp';
import { sinceStart, type SinceStart } from '$lib/sinceStart';
import { cycleInfo, cycleNote } from '$lib/cycle';
import { fitness as fitnessOf, type Fitness } from '$lib/fitness';
import { strengthTrend } from '$lib/strength';

export interface DayIntake { kcal: number; protein: number; carbs: number; fat: number; items: number }

export interface BodyProfile {
  heightCm: number; age: number; gender: 'male' | 'female'; activityLevel: ActivityLevel; bodyFatPct: number | null;
}

export interface Body {
  today: string;
  weight: WeightVerdict | null;
  /** The trend weight, else the latest reading, else the onboarding weight. */
  currentKg: number | null;
  firstKg: number | null;
  goalKg: number | null;
  pace: Pace;
  /** Only while genuinely losing toward a goal below; null otherwise. */
  weeksToGoal: number | null;
  /** Logged food per day. A day with no itemised food falls back to its
   *  quick-logged kcal, so older quick-log days still count. */
  intake: Map<string, DayIntake>;
  /** Last Sunday's learned estimate: logged days, rate, interval. The target
   *  itself is built on target.maintenance (smoothed across Sundays). */
  learned: AdaptiveTdee;
  target: LiveTargetResult;
  week: WeekBudget | null;
  /** Tomorrow's share, from what's logged through today: what the morning
   *  briefing says. On a Sunday it's a fresh week at this week's target. */
  tomorrow: WeekBudget | null;
  proteinTargetG: number;
  bodyFatPct: number | null;
  profile: BodyProfile | null;
  /** The least this body can burn (resting × 1.2), when the profile allows. */
  floorKcal: number | null;
  /** The next stop on the way to the goal (user_settings.milestone). */
  next: MilestoneState | null;
  /** How far the learned maintenance sits under that floor: food the log
   *  consistently doesn't carry. Fine while it's steady — the target is in
   *  the log's units. null when the log isn't short. */
  logShortKcal: number | null;
  /** Keeping it off since this day (user_settings.keep_since): the job is
   *  holding, not losing. null while losing toward the goal. */
  keepSince: string | null;
  /** The trend has held at or under the goal for three days and keeping
   *  hasn't been chosen yet: Today asks "keep it here, or aim lower?". */
  goalHeld: boolean;
}

function intakeByDate(food: any[], daily: any[]): Map<string, DayIntake> {
  const m = new Map<string, DayIntake>();
  for (const f of food) {
    const d = m.get(f.date) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, items: 0 };
    d.kcal += +f.kcal || 0; d.protein += +f.protein_g || 0; d.carbs += +f.carbs_g || 0; d.fat += +f.fat_g || 0; d.items++;
    m.set(f.date, d);
  }
  for (const l of daily) {
    if (!m.has(l.date) && (+l.kcal || 0) > 0) m.set(l.date, { kcal: +l.kcal, protein: 0, carbs: 0, fat: 0, items: 0 });
  }
  return m;
}

export const body: Readable<Body> = derived(
  [liveWeights(), liveGoal(), liveFoodLogs(), liveDailyLogs(), liveProfile(), liveTracks(), liveGoalReason(), todayDate],
  ([$weights, $goal, $food, $daily, $profile, $tracks, $goalReason, $today]) => {
    const today = $today as string;
    const weights = (($weights as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight }));
    const p = $profile as any;
    const goalKg = ($goal as number | null) ?? null;

    const weight = weightVerdict(weights, Date.parse(`${today}T12:00:00`));
    // Before seven mornings make a trend, their average: the budget, "kg to
    // lose" and the goal date must not swing with one morning's water.
    const currentKg = weight?.trendKg ?? weight?.meanKg ?? weight?.latestKg ?? (p?.start_kg != null ? +p.start_kg : null);
    const firstKg = weights.length ? weights[0].weight : null;

    const bf = (($tracks as any[]) ?? []).filter((t) => t.name === 'body_fat' && t.value > 0)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const bodyFatPct = bf.length ? +bf[bf.length - 1].value : null;
    const age = ageFrom(p?.birth_year);
    const profile: BodyProfile | null =
      p && p.height_cm && age != null && (p.sex === 'male' || p.sex === 'female') && p.activity_level
        ? { heightCm: +p.height_cm, age, gender: p.sex, activityLevel: p.activity_level as ActivityLevel, bodyFatPct }
        : null;

    const intake = intakeByDate(($food as any[]) ?? [], ($daily as any[]) ?? []);
    // Keeping it off: under the ceiling (a kilo over the goal, where the line
    // sits) the budget is maintenance; over it, the usual one gentle step down
    // until the trend is back under. STOP Regain's yellow zone, plan in hand.
    const keepSince: string | null = p?.keep_since ?? null;
    const budgetGoal = keepSince && goalKg != null && currentKg != null
      ? (currentKg <= goalKg + LINE_MARGIN_KG ? currentKg : goalKg) : goalKg;
    const weekStart = mondayOf(new Date(`${today}T12:00:00`));
    const weekly = weeklyMaintenance({
      intake: Array.from(intake, ([date, d]) => ({ date, kcal: d.kcal })), weights, weekStart,
      formulaKcal: profile && currentKg ? calcTdee({ weightKg: currentKg, ...profile }) : null,
    });
    // Last week's check-in answers move this week's target, for this week only
    // (stored on the reviewed week's Monday; see WeekCheckIn).
    const reviewed = shiftYmd(-7, new Date(`${weekStart}T12:00:00`));
    const nudge = +((($daily as any[]) ?? []).find((l) => l.date === reviewed)?.week_check?.kcalDelta ?? 0) || 0;
    const target = resolveCalorieTarget({
      goalKg: budgetGoal, currentWeightKg: currentKg, learnedTdee: weekly.kcal,
      profile, storedTarget: parseCalorieTarget($goalReason as string | null), adjustKcal: nudge,
      usualKcal: weekly.latest.meanIntake,
    });
    // The pace the plan is built for; 0.5 kg/week when only a stored target exists.
    const cutting = !keepSince && goalKg != null && currentKg != null && currentKg - goalKg > 0.5;
    const plan = target.direction === 'lose' ? target.planKgPerWeek : cutting && target.direction == null ? 0.5 : null;
    // "Too fast" means past 1% of bodyweight a week, whatever the plan said.
    const pace = paceVsPlan(weight, plan, currentKg ? currentKg * 0.01 : null);

    // A finish date only from a loss the interval confirms — never from two
    // mornings' readings, and never while the trend is flat or rising.
    const losing = weight && weight.loKgPerWeek > 0 && (pace === 'on-pace' || pace === 'faster' || pace === 'slower');
    const weeksToGoal = losing && goalKg != null && currentKg != null && currentKg > goalKg
      ? Math.ceil((currentKg - goalKg) / (weight as WeightVerdict).rateKgPerWeek)
      : null;

    const floorKcal = profile && currentKg ? burnFloor({ weightKg: currentKg, ...profile }) : null;
    const short = target.basis === 'learned' && floorKcal != null && target.maintenance != null ? floorKcal - target.maintenance : 0;

    return {
      today, weight, currentKg, firstKg, goalKg, pace, weeksToGoal, intake, learned: weekly.latest, target,
      week: weekBudget(target.target, intake, today),
      tomorrow: weekBudget(target.target, intake, shiftYmd(1, new Date(`${today}T12:00:00`))),
      proteinTargetG: Math.max(1, proteinTargetG(goalKg, currentKg)),
      bodyFatPct, profile, floorKcal,
      next: milestoneState(p?.milestone ?? null, currentKg, p?.height_cm ? +p.height_cm : null, {
        today, trendOn: (ymd) => weightVerdict(weights, Date.parse(`${ymd}T12:00:00`))?.trendKg ?? null,
      }),
      logShortKcal: short >= 100 ? Math.round(short / 10) * 10 : null,
      keepSince,
      goalHeld: !keepSince && goalKg != null && firstKg != null && firstKg > goalKg + 1
        && heldUnder(goalKg + 0.05, (ymd) => weightVerdict(weights, Date.parse(`${ymd}T12:00:00`))?.trendKg ?? null, today),
    };
  },
);

/** The week's shape: twelve weeks of logged days and mornings, by weekday. */
export const shape: Readable<WeekShape | null> = derived(
  [body, liveWeights()],
  ([$body, $weights]) => weekShape($body.intake, (($weights as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight })), $body.today),
);

/** "Why is the scale up?": this morning's reading explained from the person's
 *  own log when it's high (src/lib/scaleUp.ts); null on an ordinary morning. */
export const scaleUp: Readable<UpExplained | null> = derived(
  [body, liveWeights(), shape, liveWorkoutLogs(), liveActivitySessions(), liveSessionCompletions(), liveProfile(), liveDailyLogs()],
  ([$b, $weights, $shape, $logs, $activity, $done, $profile, $daily]) => {
    const weights = (($weights as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight }));
    const today = weights.find((w) => w.date === $b.today);
    if (!today) return null;
    const before = weights.filter((w) => w.date < $b.today);
    const prev = before.at(-1) ?? null;
    const input = {
      today: $b.today, kg: today.weight, prev: prev ? { date: prev.date, kg: prev.weight } : null,
      trendKg: $b.weight?.trendKg ?? null,
      // The trend as it stood before this morning's reading.
      trendPrevKg: weightVerdict(before, Date.parse(`${shiftYmd(-1, new Date(`${$b.today}T12:00:00`))}T12:00:00`))?.trendKg ?? null,
      scatterKg: $b.weight?.scatterKg ?? null,
      intake: $b.intake, weekdayOffsets: $shape?.scale ?? null,
      trained: trainedDates(($done as any[]) ?? [], ($activity as any[]) ?? [], ($logs as any[]) ?? []),
    };
    const plain = explainUp(input);
    if (!plain || !($profile as any)?.cycle_aware) return plain;
    // Period-aware: only on a high morning, the person's own swing (cycle.ts),
    // from the last two hundred days of mornings against their trend.
    const starts = (($daily as any[]) ?? []).filter((l) => l.period).map((l) => l.date as string);
    const from = shiftYmd(-200, new Date(`${$b.today}T12:00:00`));
    const residuals = weights.filter((w) => w.date >= from).flatMap((w) => {
      const t = weightVerdict(weights, Date.parse(`${w.date}T12:00:00`))?.trendKg;
      return t == null ? [] : [{ date: w.date, kg: w.weight - t }];
    });
    return explainUp({ ...input, cycleNote: cycleNote(cycleInfo(starts, residuals, $b.today), starts, $b.today) });
  },
);

/** Why the scale isn't moving — once, for Today and Progress alike. */
export const stall: Readable<StallDiagnosis | null> = derived(
  [body, liveWorkoutLogs(), liveActivitySessions(), shape, liveDailySteps()],
  ([$body, $logs, $activity, $shape, $steps]) => diagnoseStall({
    pace: $body.pace, intake: $body.intake, floorKcal: $body.floorKcal, today: $body.today,
    trainingDays: trainedDates([], ($activity as any[]) ?? [], ($logs as any[]) ?? []), shape: $shape,
    // Today is only half walked, so the steps' trend ends yesterday.
    steps: signalTrend('steps', [...(($steps as Map<string, number>) ?? new Map())].filter(([d]) => d < $body.today).map(([date, value]) => ({ date, value })),
      Date.parse(`${shiftYmd(-1, new Date(`${$body.today}T12:00:00`))}T12:00:00`)),
  }),
);

/** Your line, judged on the same trend every other screen shows. Its own store
 *  so a food entry doesn't recompute a year of daily trends. */
export const line: Readable<LineState | null> = derived(
  [liveWeights(), liveProfile(), todayDate],
  ([$weights, $profile, $today]) => lineState(
    ($profile as any)?.line ?? null,
    (($weights as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight })),
    $today as string,
  ),
);

/** "Am I getting fitter?", beside "am I losing weight?": the resting heart
 *  rate's trend, lifts, training days and steps (src/lib/fitness.ts). Training
 *  days from the watch and the log alone, like the stall: the completions store
 *  keeps only the last ten. */
export const fitness: Readable<Fitness> = derived(
  [liveBiometrics(), liveDailySteps(), liveWorkoutLogs(), liveActivitySessions(), todayDate],
  ([$bio, $steps, $logs, $activity, $today]) => fitnessOf({
    today: $today as string,
    restingHr: (($bio as any[]) ?? []).filter((b) => b.resting_hr != null && b.date).map((b) => ({ date: b.date as string, bpm: +b.resting_hr })),
    steps: $steps as Map<string, number>,
    trained: trainedDates([], ($activity as any[]) ?? [], ($logs as any[]) ?? []),
    strength: strengthTrend(($logs as any[]) ?? [], { asOf: Date.parse(`${$today}T12:00:00`) }),
    since: [...($steps as Map<string, number>).keys(), ...(($bio as any[]) ?? []).map((b) => b.date), ...(($activity as any[]) ?? []).map((a) => a.date), ...(($logs as any[]) ?? []).map((l) => l.date)]
      .filter(Boolean).sort()[0] ?? null,
  }),
);

/** "Is it working?": the first two weeks against the last two, from the same
 *  weigh-ins, food days and trained days as everything else (src/lib/sinceStart.ts). */
export const beforeAfter: Readable<SinceStart | null> = derived(
  [liveWeights(), body, liveWorkoutLogs(), liveActivitySessions(), todayDate],
  ([$w, $b, $logs, $activity, $today]) => sinceStart({
    today: $today as string,
    weights: (($w as any[]) ?? []).filter((x) => x?.date && x.weight != null).map((x) => ({ date: x.date as string, weight: +x.weight })),
    logged: [...$b.intake.keys()],
    trained: trainedDates([], ($activity as any[]) ?? [], ($logs as any[]) ?? []),
  }),
);

/** Every weigh-in with the trend as it stood that morning: Progress's chart,
 *  drawn from the same fit as every other screen. Its own store, like `line`,
 *  so a food entry doesn't refit a year of mornings. */
export const trendSeries: Readable<Array<{ date: string; kg: number; trendKg: number | null }>> = derived(
  liveWeights(),
  ($weights) => {
    const weights = (($weights as any[]) ?? []).map((w) => ({ date: w.date as string, weight: +w.weight }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return weights.map((w) => ({ date: w.date, kg: w.weight, trendKg: weightVerdict(weights, Date.parse(`${w.date}T12:00:00`))?.trendKg ?? null }));
  },
);

/** The Today hero and the page's glow, read off the same trend (src/lib/pulse.ts).
 *  While keeping it off, with the days the trend stayed under the ceiling. */
export const todayPulse: Readable<Pulse> = derived([body, liveProfile(), line, liveWeights()], ([$b, $p, $line, $weights]) => {
  const program = ($p as any)?.program ?? null;
  const week = programWeek(program, $b.today);
  let keep: KeepInput | null = null;
  if ($b.keepSince && $b.goalKg != null) {
    const weights = (($weights as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight }));
    const ceilingKg = $line && !$line.misdrawn ? $line.kg : $b.goalKg + LINE_MARGIN_KG;
    // The last sixty days at most, from the day keeping began.
    let inside = 0, days = 0;
    for (let k = 59; k >= 0; k--) {
      const d = shiftYmd(-k, new Date(`${$b.today}T12:00:00`));
      if (d < $b.keepSince) continue;
      const t = weightVerdict(weights, Date.parse(`${d}T12:00:00`))?.trendKg;
      if (t == null) continue;
      days++;
      if (t <= ceilingKg) inside++;
    }
    keep = { goalKg: $b.goalKg, ceilingKg, inside, days, since: $b.keepSince };
  }
  return pulse({
    weight: $b.weight, pace: $b.pace, firstKg: $b.firstKg, goalKg: $b.goalKg, next: $b.next,
    planKgPerWeek: $b.target.direction === 'lose' ? $b.target.planKgPerWeek : null,
    restartedOn: week === 1 || week === 2 ? program.start : null,
    keep,
  });
});
