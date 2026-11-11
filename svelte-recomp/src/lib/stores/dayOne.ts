// The day-one plan, live. Like todayPulse in stores/body.ts: one derived store the whole
// app shares, so the Today hero and anything else that wants to nudge a new user
// read the same numbers and can never disagree.
import { derived, type Readable } from 'svelte/store';
import { liveProfile, liveWeights, liveFoodLogs, liveWorkoutLogs, liveSchedule } from './live';
import { dayOnePlan, type DayOnePlan } from '$lib/dayOne';
import { cleanPlans } from '$lib/moments';
import { body } from './body';

const _profile = liveProfile();
const _weights = liveWeights();
const _foodLogs = liveFoodLogs();
const _workoutLogs = liveWorkoutLogs();
const _schedule = liveSchedule();

export const dayOne: Readable<DayOnePlan | null> = derived(
  [_profile, _weights, _foodLogs, _workoutLogs, _schedule, body],
  ([$profile, $weights, $foodLogs, $workoutLogs, $schedule, $body]) => {
    const weights = ($weights as any[]) ?? [];
    return dayOnePlan({
      profile: $profile as any,
      // The one current weight (stores/body.ts): before a trend, the average
      // of the mornings so far, so morning two's water can't move the goal.
      currentWeightKg: $body.currentKg,
      weighInCount: weights.length,
      foodLogCount: (($foodLogs as any[]) ?? []).length,
      workoutLogCount: (($workoutLogs as any[]) ?? []).length,
      scheduleDays: (($schedule as any[]) ?? []).length,
      planCount: Object.keys(cleanPlans(($profile as any)?.plans)).length,
    });
  }
);
