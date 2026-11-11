// Everything the weekly review reads, gathered once. The review card on
// Progress and the Sunday check-in build the same week from the same rows — the
// card for Monday..today, the check-in for the week that just ended.
import { derived } from 'svelte/store';
import { liveWeights, liveDailySteps, liveBiometrics, liveWorkoutLogs, liveActivitySessions, liveSessionCompletions } from './live';
import { trainedDates } from '$lib/training';
import { body } from './body';
import type { WeeklyReviewInput } from '$lib/weeklyReview';

export const reviewInputs = derived(
  [body, liveWeights(), liveDailySteps(), liveBiometrics(), liveWorkoutLogs(), liveActivitySessions(), liveSessionCompletions()],
  ([$body, $weights, $steps, $bio, $logs, $activity, $done]): Omit<WeeklyReviewInput, 'today'> => ({
    weights: ($weights as any[]).map((w) => ({ date: w.date, weight: +w.weight })),
    intake: Array.from($body.intake, ([date, d]) => ({ date, kcal: d.kcal, protein: d.protein })),
    steps: Array.from($steps, ([date, count]) => ({ date, count })),
    sleep: ($bio as any[]).map((b) => ({ date: b.date, sleep_hours: b.sleep_hours ?? null })),
    workouts: $logs as any,
    trained: trainedDates(($done as any[]) ?? [], ($activity as any[]) ?? [], ($logs as any[]) ?? []),
    // The maintenance this week's target is built on, when it's learned.
    learnedTdee: $body.target.basis === 'learned' ? $body.target.maintenance : null,
    proteinTargetG: $body.goalKg ? $body.proteinTargetG : 0,
    goalKg: $body.goalKg,
  }),
);
