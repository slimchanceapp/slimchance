import { writable, derived, type Writable } from 'svelte/store';
import { liveQuery } from 'dexie';
import db from '$lib/db/dexie';
import { userId } from './user';
import { nowTick } from './refresh';
import { overlaySessions } from '$lib/program';
import { todayYmd } from '$lib/date';
import { useUnits } from './units';

let currentUid = '';

const alarmResults = writable<any[]>([]);
const weightResults = writable<any[]>([]);
const logResults = writable<Map<string, any>>(new Map());
const goalResult = writable<number | null>(null);
const goalReasonResult = writable<string | null>(null);
const scheduleResults = writable<any[]>([]);
const sessionResults = writable<Map<string, any>>(new Map());
const workoutLogResults = writable<any[]>([]);
const foodLogResults = writable<any[]>([]);
const biometricResults = writable<any[]>([]);
const checksResults = writable<any[]>([]);
const sessionsResults = writable<any[]>([]);
const stepResults = writable<any[]>([]);
const trackResults = writable<any[]>([]);
const activityResults = writable<any[]>([]);
const customRecipeResults = writable<any[]>([]);
const medResults = writable<any[]>([]);
const medEventResults = writable<any[]>([]);
const profileResult = writable<any | null>(null);
// Distinguishes "not loaded yet" from "loaded and genuinely empty" — without
// this the onboarding gate flashes on every launch before user_settings arrives.
const profileLoaded = writable(false);

userId.subscribe((uid) => {
  if (!uid || uid === currentUid) return;
  currentUid = uid;

  liveQuery(() => db.table('alarms').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => alarmResults.set(data),
    error: () => alarmResults.set([])
  });

  liveQuery(() => db.table('weights').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => weightResults.set(data),
    error: () => weightResults.set([])
  });

  liveQuery(() => db.table('daily_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => {
      const map = new Map<string, any>();
      for (const row of data) map.set(row.date, row);
      logResults.set(map);
    },
    error: () => logResults.set(new Map())
  });

  liveQuery(() => db.table('user_settings').where('user_id').equals(uid).first()).subscribe({
    next: (data) => {
      // Before anything reads the profile, so every number it drives is
      // already in the person's unit.
      if (data) useUnits(data.units);
      goalResult.set(data?.goal_kg ?? null);
      goalReasonResult.set(data?.goal_reason ?? null);
      profileResult.set(data ?? null);
      profileLoaded.set(true);
    },
    error: () => {
      goalResult.set(null);
      goalReasonResult.set(null);
      profileResult.set(null);
      profileLoaded.set(true);
    }
  });

  liveQuery(() => db.table('workout_schedule').where('user_id').equals(uid).sortBy('day_of_week')).subscribe({
    next: (data) => scheduleResults.set(data),
    error: () => scheduleResults.set([])
  });

  liveQuery(() => db.table('workout_sessions_custom').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => {
      const map = new Map<string, any>();
      for (const row of data) map.set(row.key, row);
      sessionResults.set(map);
    },
    error: () => sessionResults.set(new Map())
  });

  liveQuery(() => db.table('workout_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => workoutLogResults.set(data),
    error: () => workoutLogResults.set([])
  });

  liveQuery(() => db.table('food_logs').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => foodLogResults.set(data),
    error: () => foodLogResults.set([])
  });

  liveQuery(() => db.table('biometrics').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => biometricResults.set(data),
    error: () => biometricResults.set([])
  });

  liveQuery(() => db.table('checks').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => checksResults.set(data),
    error: () => checksResults.set([])
  });

  liveQuery(() => db.table('sessions').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => sessionsResults.set(data),
    error: () => sessionsResults.set([])
  });

  liveQuery(() => db.table('steps').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => stepResults.set(data),
    error: () => stepResults.set([])
  });

  liveQuery(() => db.table('tracks').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => trackResults.set(data),
    error: () => trackResults.set([])
  });

  liveQuery(() => db.table('activity_sessions').where('user_id').equals(uid).sortBy('start')).subscribe({
    next: (data) => activityResults.set(data),
    error: () => activityResults.set([])
  });

  liveQuery(() => db.table('recipes_custom').where('user_id').equals(uid).sortBy('created_at')).subscribe({
    next: (data) => customRecipeResults.set(data),
    error: () => customRecipeResults.set([])
  });

  liveQuery(() => db.table('medications').where('user_id').equals(uid).toArray()).subscribe({
    next: (data) => medResults.set(data),
    error: () => medResults.set([])
  });

  liveQuery(() => db.table('med_events').where('user_id').equals(uid).sortBy('date')).subscribe({
    next: (data) => medEventResults.set(data),
    error: () => medEventResults.set([])
  });
});

export function liveAlarms() {
  return { subscribe: alarmResults.subscribe };
}

export function liveLog(date: string) {
  // derived subscribes lazily and lets go with its last subscriber.
  return derived(logResults, (map) => map.get(date) || null);
}

// All daily_logs rows as a flat array (every date). Used to build the intake
// series for adaptive-TDEE — quick-logged single-kcal days count too, not just
// itemised food_logs.
// One derived store for every caller. Each call used to create its own
// writable and subscribe it to logResults for good — a subscription leaked per
// component mount.
const dailyLogRows = derived(logResults, (map) => Array.from(map.values()));
export function liveDailyLogs() {
  return { subscribe: dailyLogRows.subscribe };
}

export function liveWeights() {
  return { subscribe: weightResults.subscribe };
}

export function liveGoal() {
  return { subscribe: goalResult.subscribe };
}

// The "why" behind the current goal weight (see the Plan page's
// TDEE-backed "Set as my goal" flow) -- so the goal is never shown as
// just a bare, unexplained number anywhere it's displayed.
export function liveGoalReason() {
  return { subscribe: goalReasonResult.subscribe };
}

export function liveSchedule() {
  return { subscribe: scheduleResults.subscribe };
}

// The sessions every screen trains from: the user's own, with an active
// program's sessions laid over their gym days (see $lib/program). One place, so
// Today, Train, the nudges and recovery can never disagree about what today's
// session is — and the user's own plan returns untouched when the program ends.
const overlaidSessions = derived(
  [sessionResults, scheduleResults, profileResult, nowTick],
  ([sessions, schedule, profile]) => overlaySessions(sessions, schedule, profile?.program, todayYmd()),
);

/** The user's own sessions, before any program is laid over them: what
 *  overlaySessions needs to work out another day's session (the briefing). */
export function liveOwnSessions() {
  return { subscribe: sessionResults.subscribe };
}

export function liveWorkoutSessions() {
  return { subscribe: overlaidSessions.subscribe };
}

// All workout_logs rows for the current user (every date/exercise). Kept as
// a flat array so the UI can derive both "today's entry" and "most recent
// prior entry" (for progressive-overload prompts) per exercise without a
// separate query per exercise.
export function liveWorkoutLogs() {
  return { subscribe: workoutLogResults.subscribe };
}

// All food_logs rows for the current user (every date). Consumers filter
// by date client-side for daily totals.
export function liveFoodLogs() {
  return { subscribe: foodLogResults.subscribe };
}

// All biometrics rows (sleep/RHR/HRV) for the current user, used by the
// readiness score and training-load calculations.
export function liveBiometrics() {
  return { subscribe: biometricResults.subscribe };
}

// Checklist items for a specific date, read live from IndexedDB. Used by
// the Today page's evening checklist -- fixes the same stale-until-
// reload race as alarms/weights/meal_plans (a realtime push from
// another device updates IndexedDB correctly, but a manual
// "$syncStatus === 'synced'" reload effect can miss it entirely if
// syncStatus had already settled before the push arrived).
export function liveChecks(date: string) {
  const store: Writable<any[]> = writable([]);
  checksResults.subscribe((all) => {
    store.set(
      all
        .filter((r) => r.date === date)
        .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    );
  });
  return { subscribe: store.subscribe };
}

// Workout-session "Mark Complete" history, read live from IndexedDB.
export function liveSessionCompletions() {
  const store: Writable<any[]> = writable([]);
  sessionsResults.subscribe((rows) => {
    store.set(
      [...rows]
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 10)
    );
  });
  return { subscribe: store.subscribe };
}

// All steps rows (every date) for the current user, sorted ascending by
// date. Steps are stored in their own `steps` table (not daily_logs), so
// reading them here fixes the Today page previously looking for a
// non-existent daily_logs.steps field.
export function liveSteps() {
  return { subscribe: stepResults.subscribe };
}

// One count per day: the latest reading wins (a manual entry typed after the
// watch synced, or a later sync that saw more of the day). Today and the
// weekly review both read this instead of each picking their own.
const stepsByDate = derived(stepResults, (rows) => {
  const m = new Map<string, { count: number; at: string }>();
  for (const s of rows as any[]) {
    const prev = m.get(s.date);
    if (!prev || (s.created_at || '') >= prev.at) m.set(s.date, { count: s.count, at: s.created_at || '' });
  }
  return new Map(Array.from(m, ([d, v]) => [d, v.count] as [string, number]));
});
export function liveDailySteps() {
  return { subscribe: stepsByDate.subscribe };
}

// All tracks rows (body measurements like body_fat) for the current user,
// sorted ascending by date. Powers the Body & Goals measurement history.
export function liveTracks() {
  return { subscribe: trackResults.subscribe };
}

// Watch-recorded exercise sessions (badminton, runs, strength) synced from
// Health Connect, sorted ascending by start time. Local-only cache.
export function liveActivitySessions() {
  return { subscribe: activityResults.subscribe };
}

// Recipes generated on demand for this user (see the generate-recipe edge
// function), oldest first. The Recipes page shows these alongside the built-in
// ones, newest at the top.
export function liveCustomRecipes() {
  return { subscribe: customRecipeResults.subscribe };
}

// The full user_settings row — height, birth year, sex, units, goal (see
// $lib/profile). Everything personal that used to be a hardcoded constant or
// unsaved form state.
export function liveProfile() {
  return { subscribe: profileResult.subscribe };
}

// True once user_settings has been read at least once, so the caller can tell
// "no profile yet" apart from "still loading".
export function liveProfileLoaded() {
  return { subscribe: profileLoaded.subscribe };
}

// The GLP-1 companion: medications as prescribed, and their doses and
// feelings, oldest first (src/lib/meds.ts).
export function liveMedications() {
  return { subscribe: medResults.subscribe };
}
export function liveMedEvents() {
  return { subscribe: medEventResults.subscribe };
}
