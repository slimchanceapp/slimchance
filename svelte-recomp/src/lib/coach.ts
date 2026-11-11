// Daily Focus coaching engine.
//
// Turns the raw signals the app already collects (calories, protein, sleep,
// steps, water, weight trend, workouts — including watch/Health-Connect data)
// into a short, prioritised list of ACTIONABLE guidance framed toward the
// user's goal weight. The whole point is to answer "what should I focus on
// today to get to my goal — sustainably, with a body worth keeping" rather
// than parroting numbers the watch already shows.
//
// Pure + framework-free so it's trivially unit-testable and reusable.
import { changeWord, dwt, dwtNum, wt, wtShortU } from './units.ts';

export type Severity = 'bad' | 'warn' | 'good' | 'info';

export interface FocusItem {
  id: string;
  severity: Severity;
  icon: string;
  title: string;
  /** One actionable coaching sentence — a "do something", not a number. */
  msg: string;
  /** Optional compact metric shown on the right (e.g. "1850 / 2100 kcal"). */
  metric?: string;
  /** Optional in-app nav target (relative, base is prepended by the caller). */
  href?: string;
  /** Optional YouTube video id — played INSIDE the app via VideoEmbed. */
  vid?: string;
  /** Short label for the in-app demo (e.g. "Watch how"). */
  videoLabel?: string;
}

export interface CoachInput {
  goalKg: number;
  /** Keeping it off (user_settings.keep_since): holding, not losing. */
  keeping?: boolean;
  currentWeight: number | null;
  /** kg/week; positive = losing. The trend's slope (stores/body), never two readings. */
  rateKgPerWeek: number;
  /** The trend's verdict against the plan's pace — see paceVsPlan. */
  pace: import('./body/index.ts').Pace;
  planKgPerWeek: number | null;
  /** Only while a loss is confirmed; null otherwise. */
  weeksToGoal: number | null;
  /** While it's too early to tell: how many more mornings on the scale. */
  weighInsNeeded: number | null;
  /** Set only when the trend has ruled out the plan (stalled or gaining). */
  stall: import('./body/index.ts').StallDiagnosis | null;
  /** Total kg lost since the very first logged weigh-in (the real journey). */
  totalLostKg: number | null;

  /** Daily calorie target (from the TDEE-backed goal). null if not set yet. */
  calorieTarget: number | null;
  todayKcal: number | null;
  /** Sum of calories logged Monday..today (inclusive). */
  weekKcalSoFar: number;
  /** 1 (Mon) .. 7 (Sun) — days elapsed this week including today. */
  daysElapsedThisWeek: number;

  proteinTarget: number;
  todayProtein: number | null;

  sleepHours: number | null;
  /** Optional 1..5-ish subjective/derived quality; null if unknown. */
  sleepQuality: number | null;

  stepsToday: number | null;
  stepsWeekAvg: number | null;

  /** Hydration in LITRES (the user thinks in litres, not glasses). */
  waterToday: number;
  waterTarget: number;

  /** What today is, activity-wise, derived from the training plan. */
  dayKind: 'gym' | 'active' | 'rest';
  /** Human label for today's activity (e.g. "Badminton", "Heavy Lower Body"). */
  activityLabel: string;
  workoutDoneToday: boolean;

  /** Muscle-retention read from the lift log: is strength holding while the
   *  fat comes off? Paired with weight loss below to tell the real story. */
  strengthTrend?: import('./training/index').StrengthTrend | null;
  /** A rehab program (Back Rebuild) sets the loads: no strength verdicts. */
  inProgram?: boolean;


  /** Today's watch-recorded workout (badminton, run, strength) if any — lets
   *  the coach CONFIRM the session actually happened instead of nagging. */
  watchActivityToday?: {
    label: string;
    emoji: string;
    kind: string;
    durationMin: number;
    kcal: number | null;
    distanceM: number | null;
  } | null;

  /** Local hour 0..23 — lets nudges respect time of day. */
  hour: number;
}

const SEV_WEIGHT: Record<Severity, number> = { bad: 0, warn: 1, info: 2, good: 3 };

/**
 * Extract the TDEE-backed daily intake target the user committed to, which the
 * "Set as my goal" flow embeds into user_settings.goal_reason as
 * "...target intake ~2100 kcal/day...". Returns null when no such goal exists.
 */
export function parseCalorieTarget(goalReason: string | null | undefined): number | null {
  if (!goalReason) return null;
  const m = goalReason.match(/target intake\s*~?\s*([0-9]{3,5})\s*kcal/i);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return v > 0 ? v : null;
}

/**
 * A ≤10-word gist of the stored goal_reason for the at-a-glance screens
 * (Today / Food), so the full paragraph doesn't eat half the viewport. The
 * complete rationale still lives in Progress → Body & Goals. Pulls the scenario
 * label (before the em dash) and the committed intake, e.g.
 * "Lean recomp (18% body fat) · ~2100 kcal/day".
 */
export function goalSummary(goalReason: string | null | undefined): string | null {
  if (!goalReason) return null;
  const label = goalReason.split('—')[0].trim();
  const kcal = parseCalorieTarget(goalReason);
  return kcal ? `${label} · ~${kcal} kcal/day` : label;
}

/** Suggested daily water target in LITRES — ~30 ml/kg of fluid, sane bounds. */
export function waterTargetLitres(weightKg: number | null): number {
  if (!weightKg || weightKg <= 0) return 3;
  const l = (weightKg * 30) / 1000; // 30 ml/kg
  const clamped = Math.max(2.5, Math.min(4, l));
  return Math.round(clamped / 0.25) * 0.25; // nearest 250 ml
}

/**
 * A rotating "movement snack" — something to do RIGHT NOW that changes
 * through the day (keyed by hour). On training/active days it's chair-friendly
 * mobility to prime the body before the session; on rest days it's a nudge to
 * get up and move (a short walk). Generic mobility/movement only — no medical
 * or loaded-exercise prescriptions.
 */
export function movementSnack(dayKind: 'gym' | 'active' | 'rest', hour: number): { icon: string; title: string; msg: string; vid: string; videoLabel: string } {
  // Each snack carries a verified, embeddable YouTube `vid` so the drill plays
  // INSIDE the app (VideoEmbed modal) — no bouncing out to a YouTube search.
  const prime = [
    { t: 'Stand up and do 10 slow bodyweight squats to wake the legs up.', v: 'eFEVKmp3M4g' },
    { t: 'Seated: 10 thoracic rotations each side — twist gently, open the chest.', v: 'QOnR-NCHL0w' },
    { t: 'Hip-flexor stretch: half-kneel each side 30s. Undoes hours of sitting.', v: 'gqoPYLUgP48' },
    { t: '20 shoulder rolls back + 5 slow neck circles each way. Reset your posture.', v: 'JpaYwJLzElM' },
    { t: 'Deep squat hold 30s — sink into it, let the hips and ankles open.', v: 'nJYYkH_khEg' },
    { t: 'Standing hamstring reach 30s + 10 calf raises. Prep the posterior chain.', v: 'LVY692zJK0A' },
    { t: 'Wrist + shoulder circles, then 10 band-free "pull-aparts" (arms wide). Prime for pulling.', v: 'SuvO4TBwSu4' },
    { t: 'Ankle circles 10 each way + 5 slow lunges per leg. Get the joints ready.', v: '269TXz_AtHE' },
  ];
  const rest = [
    { t: "Get up and walk for 5 minutes — even around the house. Break the sitting.", v: 'GE3SkbTsBUc' },
    { t: 'Take the long way to refill your water. Steps are the easiest lever you have.', v: 'pqpAxsloj-g' },
    { t: 'Stand, stretch tall, then a slow 2-minute walk. Every hour adds up.', v: 'H_VH2eilukE' },
    { t: 'Do a lap outside if you can — 10 minutes of easy walking clears the head.', v: 'qzQQ4b5LFzQ' },
    { t: '10 squats + a short walk. Keep the body moving on your day off.', v: 'eFEVKmp3M4g' },
    { t: 'Calves + hip-flexor stretch, then stroll for a few minutes.', v: 'fG_-dQ4J3Ig' },
    { t: 'Set a 5-minute walk timer. Movement now, not just at the gym.', v: 'GmZF8rCH3CM' },
    { t: 'Up on your feet — shoulder rolls, then a gentle walk to reset.', v: '9wdTHICztmQ' },
  ];
  const list = dayKind === 'rest' ? rest : prime;
  const pick = list[((hour % 24) + list.length) % list.length];
  if (dayKind === 'gym' || dayKind === 'active') {
    return { icon: '🤸', title: 'Prime for later', msg: pick.t, vid: pick.v, videoLabel: 'Watch how ▸' };
  }
  return { icon: '🚶', title: 'Move a little', msg: pick.t, vid: pick.v, videoLabel: 'Watch how ▸' };
}

export function buildDailyFocus(i: CoachInput): FocusItem[] {
  const items: FocusItem[] = [];
  const evening = i.hour >= 17;
  const afternoon = i.hour >= 13;

  // — 1. Weight trend headline: is the pace right for a keepable body? —
  // Read off the ONE trend (stores/body): its verdict against the plan, with
  // the 95% interval behind it. Nothing here is computed from two mornings.
  if (i.keeping && i.currentWeight != null) {
    // Keeping it off: the question is "still inside the range?", never
    // "losing fast enough?". The ceiling's own card handles being over it.
    items.push(i.pace === 'gaining'
      ? { id: 'weight-keep-drift', href: '/progress', severity: 'info', icon: '⚖️', title: 'Creeping up',
          msg: `The trend is rising ${dwt(i.rateKgPerWeek, 2)} a week. Still inside your range: this is the moment your ceiling plan is for.` }
      : { id: 'weight-keep', href: '/progress', severity: 'good', icon: '⚖️', title: 'Holding',
          msg: 'Inside your range. Weigh most mornings and keep doing what you’re doing.' });
  } else if (i.currentWeight != null) {
    const w = i.currentWeight;
    const href = '/progress#body-goals';
    const lostCtx = i.totalLostKg != null && i.totalLostKg >= 3 ? ` You're ${dwt(i.totalLostKg)} down since you started.` : '';
    const rate = dwt(i.rateKgPerWeek, 2);
    const rateNum = dwtNum(i.rateKgPerWeek, 2);
    const perWk = `${changeWord()}/wk`;
    const plan = i.planKgPerWeek != null ? `${dwt(i.planKgPerWeek)} a week` : 'your plan';
    // The arithmetic first, the room second — never "log more": the target is
    // set in the log's own units, so a log that leaves the oil out still works.
    const why = i.stall
      ? ` At ~${i.stall.avgKcal.toLocaleString()} logged a day the scale ${i.pace === 'gaining' ? 'creeps up' : 'holds'}${i.calorieTarget ? `, so this week's target is ${i.calorieTarget.toLocaleString()} — one step down` : ''}. Progress shows where the room is.`
      : ' Progress shows where to look.';
    if (w <= i.goalKg) {
      items.push({
        id: 'weight-goal', href, severity: 'good', icon: '🎯', title: 'Goal weight reached',
        msg: `You're at ${wt(w)}, at your ${wtShortU(i.goalKg)} goal. Keeping it is the job now: weigh most mornings, and decide what you'll do if the trend crosses your ceiling.`,
      });
    } else if (i.pace === 'gaining') {
      items.push({
        id: 'weight-up', href: '/progress#why-stalled', severity: 'warn', icon: '📈', title: 'Trending up',
        msg: `The five-week trend is rising — ${rate} a week, more than the scale's day-to-day noise can explain.${why}`,
        metric: `+${rateNum} ${perWk}`,
      });
    } else if (i.pace === 'stalled') {
      items.push({
        id: 'weight-plateau', href: '/progress#why-stalled', severity: 'warn', icon: '⚖️', title: `Not losing — holding near ${wt(w, 0)}`,
        msg: `Five weeks of weigh-ins rule out ${plan}; the trend is flat.${why}`,
        metric: `${i.rateKgPerWeek >= 0 ? '−' : '+'}${rateNum} ${perWk}`,
      });
    } else if (i.pace === 'slower') {
      items.push({
        id: 'weight-slow', href, severity: 'info', icon: '📉', title: 'Losing, slower than planned',
        msg: `Real loss — ${rate} a week — but under ${plan}.${i.weeksToGoal ? ` At this pace: ~${i.weeksToGoal} weeks to ${wtShortU(i.goalKg)}.` : ''} If that's fine, change nothing; if not, trim ~200 kcal a day.`,
        metric: `−${rateNum} ${perWk}`,
      });
    } else if (i.pace === 'faster') {
      items.push({
        id: 'weight-fast', href, severity: 'info', icon: '🔥', title: 'Losing quickly',
        msg: `${rate} a week — well over ${plan}. Keep protein high and keep lifting heavy so what's leaving is fat, not muscle, and ease off if energy or sleep tanks.`,
        metric: `−${rateNum} ${perWk}`,
      });
    } else if (i.pace === 'on-pace') {
      const wk = i.weeksToGoal ? `~${i.weeksToGoal} weeks to ${wtShortU(i.goalKg)}` : `heading to ${wtShortU(i.goalKg)}`;
      items.push({
        id: 'weight-ontrack', href, severity: 'good', icon: '📉', title: 'On pace',
        msg: `${rate} a week, on plan.${lostCtx} ${wk}. Keep doing exactly this.`,
        metric: `−${rateNum} ${perWk}`,
      });
    } else {
      const n = i.weighInsNeeded;
      items.push({
        id: 'weight-progress', href, severity: 'good', icon: '📉', title: 'Keep the weigh-ins coming',
        msg: `${n ? `${n} more mornings on the scale` : 'A few more mornings on the scale'} and the trend can tell a real change from water.${lostCtx}`,
      });
    }
  }

  // — 2. Weekly calorie margin: the "watch your budget" feature. —
  if (i.calorieTarget && i.calorieTarget > 0) {
    const target = i.calorieTarget;
    const days = Math.max(1, i.daysElapsedThisWeek);
    const avg = Math.round(i.weekKcalSoFar / days);
    const weekBudget = target * 7;
    const remaining = weekBudget - i.weekKcalSoFar;
    const daysLeft = 7 - days; // whole days after today
    const perDayLeft = daysLeft > 0 ? Math.round(remaining / daysLeft) : remaining;
    const overPerDay = avg - target;
    const metric = `${avg} / ${target} avg`;

    if (i.weekKcalSoFar <= 0) {
      // nothing logged this week yet — only nudge later in the day
      if (afternoon) {
        items.push({
          id: 'cal-log',
          severity: 'info',
          icon: '🍽️',
          title: 'Log your food',
          msg: `No calories logged this week yet. What isn't tracked drifts — a 20-second scan keeps your ${target} kcal target honest.`,
          href: '/recipes',
        });
      }
    } else if (overPerDay > target * 0.12) {
      // Never red: "the week is blown" is the thought that makes it so.
      items.push({
        id: 'cal-over',
        severity: 'warn',
        icon: '⚖️',
        title: 'The week is running over',
        msg: daysLeft > 0
          ? `About ${overPerDay} a day over this week's target. ~${Math.max(0, perDayLeft).toLocaleString()} a day for the next ${daysLeft} day${daysLeft === 1 ? '' : 's'} brings it back — or let it go and start clean on Monday.`
          : `The week finished ~${overPerDay} a day over. One week is noise on the trend — Monday starts clean.`,
        metric,
        href: '/recipes',
      });
    } else if (daysLeft > 0 && perDayLeft < target * 0.7) {
      items.push({
        id: 'cal-frontload',
        severity: 'warn',
        icon: '📊',
        title: 'Front-loaded your week',
        msg: `Only ~${Math.max(0, perDayLeft)} kcal/day left for the last ${daysLeft} day${daysLeft === 1 ? '' : 's'} to stay on budget. Bank a lighter day or two now so the weekend isn't a cliff.`,
        metric,
        href: '/recipes',
      });
    } else if (!i.stall) {
      // Never praise a log the scale has just contradicted: while the trend
      // rules out the plan, "on budget" is the wrong lesson.
      items.push({
        id: 'cal-ontrack',
        severity: 'good',
        icon: '✅',
        title: 'Calories on budget',
        msg: `Averaging ${avg} kcal — right on your ${target} target. This is the discipline that gets you to ${wtShortU(i.goalKg)}. Stay boring.`,
        metric,
      });
    }
  } else if (i.currentWeight != null) {
    items.push({
      id: 'cal-nogoal',
      severity: 'info',
      icon: '🧮',
      title: 'Set a real calorie target',
      msg: `You're logging weight but chasing no number. Open Body & Goals to get a TDEE-based daily calorie target — then every meal has a purpose.`,
    });
  }

  // — 3. Protein: the non-negotiable for a body worth keeping. —
  // Only the good news, by day. When protein is eaten can't be read off the
  // log: entries are made ahead of a meal and after it alike, so "behind on
  // protein" by the clock misfired on every day logged late (and a fixed hour
  // told anyone who fasts until mid-afternoon off daily). The evening hold
  // says what's left of the day, from the day's total.
  if (i.proteinTarget > 0) {
    const p = i.todayProtein ?? 0;
    const target = i.proteinTarget;
    if (p >= target * 0.9) {
      items.push({
        id: 'protein-hit',
        severity: 'good',
        icon: '💪',
        title: 'Protein locked in',
        msg: `${Math.round(p)} g of ${target} g — this is exactly how you keep muscle while the fat comes off. Great habit.`,
        metric: `${Math.round(p)} / ${target} g`,
      });
    }
  }

  // — 4. Sleep: recovery, cravings and fat-loss hormones. —
  if (i.sleepHours != null && i.sleepHours > 0) {
    const h = i.sleepHours;
    const metric = `${h.toFixed(1)} h`;
    if (h < 6) {
      items.push({
        id: 'sleep-low',
        severity: 'bad',
        icon: '😴',
        title: 'Under-slept',
        msg: `Only ${metric} last night. Short sleep spikes cortisol and hunger and blunts recovery — protect tonight: screens off early, aim for 7½ h+.`,
        metric,
      });
    } else if (h < 7) {
      items.push({
        id: 'sleep-ok',
        severity: 'warn',
        icon: '😴',
        title: 'Sleep a little short',
        msg: `${metric} is okay but not ideal for recovery and appetite control. An extra 30–45 min tonight makes tomorrow's target feel easier.`,
        metric,
      });
    } else {
      items.push({
        id: 'sleep-good',
        severity: 'good',
        icon: '🌙',
        title: 'Well recovered',
        msg: `${metric} of sleep — appetite hormones and recovery are on your side today. Good day to train hard.`,
        metric,
      });
    }
  }

  // — 5. Steps / NEAT: the easiest fat-loss lever there is. —
  {
    const avg = i.stepsWeekAvg;
    const today = i.stepsToday;
    if (avg != null && avg > 0 && avg < 6000) {
      items.push({
        id: 'steps-low-avg',
        severity: 'warn',
        icon: '🚶',
        title: 'Move more',
        msg: `Averaging ${Math.round(avg).toLocaleString()} steps/day. NEAT burns more than the gym — a 15-min walk after two meals closes most of the gap.`,
        metric: `${Math.round(avg).toLocaleString()}/day`,
      });
    } else if (today != null && today > 0 && today < 3000 && afternoon) {
      items.push({
        id: 'steps-low-today',
        severity: 'info',
        icon: '🚶',
        title: 'Low steps today',
        msg: `Only ${today.toLocaleString()} steps so far. A brisk 20-min walk now is free movement and clears your head.`,
        metric: `${today.toLocaleString()}`,
      });
    } else if (avg != null && avg >= 8000) {
      items.push({
        id: 'steps-good',
        severity: 'good',
        icon: '🏃',
        title: 'Great daily movement',
        msg: `${Math.round(avg).toLocaleString()} steps/day average — this NEAT is quietly doing a huge share of the work. Keep it up.`,
        metric: `${Math.round(avg).toLocaleString()}/day`,
      });
    }
  }

  // — 6. Water (litres): cheap appetite control + training support. —
  if (i.waterToday < i.waterTarget && afternoon) {
    const metric = `${i.waterToday.toFixed(1)} / ${i.waterTarget.toFixed(1)} L`;
    items.push({
      id: 'water-low',
      severity: 'info',
      icon: '💧',
      title: 'Hydrate',
      msg: `${metric} so far. Thirst masquerades as hunger — a glass before each meal curbs snacking and helps you train. Keep a bottle in sight.`,
      metric,
      href: '/recipes',
    });
  }

  // — 7. Today's activity + a rotating movement snack. —
  // Distinguish a true rest day from an ACTIVE day (badminton/cardio) that
  // has no gym "session" attached — the old logic wrongly called badminton
  // days "recovery".
  if (i.dayKind === 'gym' && !i.workoutDoneToday && !evening) {
    items.push({
      id: 'workout-today',
      severity: 'info',
      icon: '🏋️',
      title: `Training day — ${i.activityLabel || 'gym'}`,
      msg: `You've got a lifting session today. Eat protein beforehand, chase progressive overload, and log it — that record is what turns effort into a plan.`,
      href: '/workouts',
    });
  } else if (i.dayKind === 'gym' && i.workoutDoneToday) {
    items.push({
      id: 'workout-done',
      severity: 'good',
      icon: '✔️',
      title: 'Training done',
      msg: `Training done and recorded. Now feed the recovery — protein and sleep are where the muscle is actually built.`,
    });
  } else if (i.dayKind === 'active' && !i.watchActivityToday) {
    items.push({
      id: 'active-today',
      severity: 'info',
      icon: '🏸',
      title: `${i.activityLabel || 'Active'} tonight`,
      msg: `Today is your ${(i.activityLabel || 'cardio').toLowerCase()} day — this is real training, not a rest day. Fuel it, hydrate, and go move hard. It counts.`,
      href: '/workouts',
    });
  }

  // — Watch activity confirmation: when the OnePlus watch recorded a workout
  // today (badminton, a run, a strength session), CONFIRM it instead of
  // nagging — with the real duration + calories it burned. This is the payoff
  // of pulling ExerciseSession from Health Connect. —
  if (i.watchActivityToday) {
    const a = i.watchActivityToday;
    const bits: string[] = [`${a.durationMin} min`];
    if (a.kcal != null && a.kcal > 0) bits.push(`~${a.kcal} kcal burned`);
    if (a.distanceM != null && a.distanceM >= 300) bits.push(`${(a.distanceM / 1000).toFixed(1)} km`);
    const stat = bits.join(' · ');
    const scheduled = i.dayKind === 'active' || i.dayKind === 'gym';
    items.push({
      id: 'watch-activity',
      severity: 'good',
      icon: a.emoji || '⌚',
      title: `${a.label} logged from your watch`,
      msg: scheduled
        ? `${stat}. That's your session done and counted — no need to log it by hand. Refuel with protein and hydrate.`
        : `${stat}. Bonus movement your watch caught — that all counts toward your week. Nice work.`,
      metric: stat,
      href: '/workouts',
    });
  }

  // — Muscle-retention verdict: the headline that matters on a cut. Pairs the
  // lift-log strength trend with weight loss to answer "am I keeping muscle?" —
  {
    const st = i.strengthTrend;
    // During a rehab program light loads are the plan: "strength slipping,
    // keep the load heavy" would be exactly the wrong advice for a hurt back.
    if (st && st.direction !== 'insufficient' && !i.inProgram) {
      const wks = Math.max(2, Math.round(st.windowDays / 7));
      const losing = i.rateKgPerWeek > 0 || (i.totalLostKg != null && i.totalLostKg > 0);
      const mover = st.topMover ? ` (${st.topMover.name} most)` : '';
      if (st.direction === 'down') {
        items.push({
          id: 'strength-down',
          severity: 'warn',
          icon: '💪',
          title: 'Strength slipping — protect muscle',
          msg: `Your main lifts are down ~${Math.abs(st.avgPct)}% over ${wks} weeks${losing ? ' as the weight drops' : ''}${mover}. On a fast cut that's the sign muscle — not just fat — may be leaving. Protect it: hit protein hard, keep the load heavy (drop reps, not weight), and check your sleep.`,
          metric: `e1RM ${st.avgPct}%`,
          href: '/workouts',
        });
      } else if (st.direction === 'up') {
        items.push({
          id: 'strength-up',
          severity: 'good',
          icon: '💪',
          title: 'Muscle is sticking',
          msg: `Your main lifts are up ~${st.avgPct}% over ${wks} weeks${losing ? " while you're losing fat" : ''}${mover}. That's the proof the weight coming off is fat, not muscle — keep protein high and keep adding load.`,
          metric: `e1RM +${st.avgPct}%`,
          href: '/workouts',
        });
      } else {
        items.push({
          id: 'strength-hold',
          severity: 'good',
          icon: '💪',
          title: 'Strength holding',
          msg: `Your lifts are holding steady over the last ${wks} weeks${losing ? ' even in a deficit' : ''} — exactly what you want. Holding strength while your weight moves means the muscle is staying. Keep the weight on the bar.`,
          metric: 'e1RM steady',
          href: '/workouts',
        });
      }
    }
  }
  // Movement snack — rotates through the day (see movementSnack). On
  // gym/active days it's priming mobility "until you get there"; on rest
  // days it's a nudge to get up and walk.
  {
    const snack = movementSnack(i.dayKind, i.hour);
    items.push({
      id: 'move-snack',
      severity: 'info',
      icon: snack.icon,
      title: snack.title,
      msg: snack.msg,
      vid: snack.vid,
      videoLabel: snack.videoLabel,
    });
  }

  // Prioritise: worst-first, then a stable importance order within a severity.
  const order = [
    'weight-plateau', 'weight-up', 'weight-fast', 'weight-ontrack', 'weight-progress', 'weight-goal',
    'cal-over', 'cal-frontload', 'cal-ontrack', 'cal-log', 'cal-nogoal',
    'protein-none', 'protein-low', 'protein-hit',
    'sleep-low', 'sleep-ok', 'sleep-good',
    'steps-low-avg', 'steps-low-today', 'steps-good',
    'water-low',
    'watch-activity',
    'strength-down', 'strength-up', 'strength-hold',
    'workout-today', 'active-today', 'workout-done', 'move-snack', 'workout-rest',
  ];
  const rank = (id: string) => { const x = order.indexOf(id); return x < 0 ? 999 : x; };

  return items.sort((a, b) => {
    const s = SEV_WEIGHT[a.severity] - SEV_WEIGHT[b.severity];
    if (s !== 0) return s;
    return rank(a.id) - rank(b.id);
  });
}

// ---------------------------------------------------------------------------
// Folding the focus feed into three topics
// ---------------------------------------------------------------------------

export type FocusTopic = 'fuel' | 'train' | 'recover';

export interface FocusGroup {
  key: FocusTopic;
  label: string;
  emoji: string;
  /** The single most severe item in this topic — the one line worth reading. */
  lead: FocusItem;
  /** How many other items this topic is standing in for. */
  more: number;
  severity: Severity;
}

export interface FoldedFocus {
  /** The outcome line — what the body is actually doing. Not a topic. */
  headline: FocusItem | null;
  groups: FocusGroup[];
}

const TOPIC_OF: Record<string, FocusTopic> = {
  // What you eat.
  'cal-over': 'fuel', 'cal-frontload': 'fuel', 'cal-ontrack': 'fuel',
  'cal-log': 'fuel', 'cal-nogoal': 'fuel', 'tdee-adapt': 'fuel',
  'protein-none': 'fuel', 'protein-low': 'fuel', 'protein-hit': 'fuel',
  'water-low': 'fuel',
  // What you do.
  'workout-today': 'train', 'active-today': 'train', 'workout-done': 'train',
  'workout-rest': 'train', 'watch-activity': 'train', 'move-snack': 'train',
  'strength-down': 'train', 'strength-up': 'train', 'strength-hold': 'train',
  'steps-low-avg': 'train', 'steps-low-today': 'train', 'steps-good': 'train',
  // What you repair with.
  'sleep-low': 'recover', 'sleep-ok': 'recover', 'sleep-good': 'recover',
};

const TOPIC_META: Record<FocusTopic, { label: string; emoji: string }> = {
  fuel: { label: 'Food', emoji: '🍽️' },
  train: { label: 'Train', emoji: '🏋️' },
  recover: { label: 'Recover', emoji: '😴' },
};

const TOPIC_ORDER: FocusTopic[] = ['fuel', 'train', 'recover'];

/**
 * Collapse the focus feed into an outcome headline plus at most three topics.
 *
 * buildDailyFocus emits up to eleven items from eleven independent sections,
 * which the UI then showed as a hero, three pills and an "N more insights"
 * expander. That is a feed, not a focus — the word means the opposite of a
 * list, and nobody triages eleven coaching sentences before breakfast.
 *
 * Fuel / Train / Recover are the only three levers that move a recomposition,
 * so each becomes one row showing its single most severe item. The weight items
 * are deliberately NOT a topic: weight is the OUTCOME of the other three, not a
 * thing you do, so it becomes the headline. Its detail lives on Progress next
 * to Body & Goals.
 *
 * Pure — no Svelte, no stores. See selfcheck.js.
 */
export function foldDailyFocus(items: FocusItem[]): FoldedFocus {
  const headline = items.find((i) => i.id.startsWith('weight-')) ?? null;

  const buckets = new Map<FocusTopic, FocusItem[]>();
  for (const item of items) {
    if (item === headline) continue;
    const topic = TOPIC_OF[item.id];
    // An unmapped id means a new coach section shipped without being assigned a
    // topic. Dropping it silently would hide real coaching, so it lands in
    // train — the catch-all "what you do today" bucket — and stays visible.
    const key = topic ?? 'train';
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  const groups: FocusGroup[] = [];
  for (const key of TOPIC_ORDER) {
    const list = buckets.get(key);
    if (!list || list.length === 0) continue;
    // items arrives already sorted worst-first by buildDailyFocus, so the first
    // item in each bucket is that topic's most severe.
    const lead = list[0];
    groups.push({
      key,
      label: TOPIC_META[key].label,
      emoji: TOPIC_META[key].emoji,
      lead,
      more: list.length - 1,
      severity: lead.severity,
    });
  }

  // Worst topic first, so a red Fuel row outranks a green Train row, but ties
  // keep the stable Fuel → Train → Recover reading order.
  groups.sort((a, b) => SEV_WEIGHT[a.severity] - SEV_WEIGHT[b.severity]);

  return { headline, groups };
}

/**
 * What Today's Focus says: one thing, and only when today needs it. The most
 * pressing Fuel, Train or Recover item at warn or worse, else nothing. Weight
 * is left out on purpose: it's the outcome, and the Pulse already says it.
 * A good day passes in silence; good news comes as a toast when it happens.
 */
export function todaysFocus(items: FocusItem[]): FocusItem | null {
  return foldDailyFocus(items).groups.find((g) => SEV_WEIGHT[g.severity] <= SEV_WEIGHT.warn)?.lead ?? null;
}

