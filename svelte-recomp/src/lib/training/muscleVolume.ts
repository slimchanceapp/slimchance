// Weekly muscle-group VOLUME balance.
//
// The app already has a Fitbod-style muscle *recovery* grid (how long since a
// muscle was worked). That answers "what's fresh to train today" — but not the
// question that decides whether a muscle actually grows: am I giving it enough
// HARD SETS PER WEEK? The hypertrophy literature converges on ~10 working sets
// per muscle per week as a productive floor (MEV≈8-10) and ~20 as the ceiling
// where returns flatten and junk volume/recovery cost climb (MAV≈18-22). This
// module counts a rolling week of working sets per muscle group and grades each
// against that range, so under- and over-trained muscles are named.
//
// Pure — no Svelte/Dexie — so it's unit-tested in selfcheck.js.

import type { StrengthLog } from './strength';

export type VolumeStatus = 'none' | 'low' | 'optimal' | 'high';

export interface MuscleVolume {
  group: string;
  sets: number;          // total weekly working-set equivalents (lifting + sport)
  liftSets: number;      // hard sets from logged lifting
  sportSets: number;     // set-equivalents contributed by sport/activity
  status: VolumeStatus;
  /** How far from the nearest edge of the optimal band, in sets (0 when inside). */
  gap: number;
}

export interface VolumeReport {
  windowDays: number;
  perMuscle: MuscleVolume[];
  undertrained: string[]; // groups below the floor (incl. never trained)
  overreaching: string[]; // groups above the ceiling
  totalSets: number;
  sportSets: number;      // total set-equivalents from sport this window
  headline: string | null;
}

/** Productive weekly working-set band per muscle (sets). */
export const SET_FLOOR = 10;
export const SET_CEILING = 20;
/** Below this, a muscle is essentially maintenance/neglected, not growing. */
export const SET_MIN_STIMULUS = 6;
/** How many hard-set-equivalents one full-load (1.0), duration-scaled sport
 *  muscle-load unit is worth. 4h/week of badminton (calves load ≈1.05 × 1.5h
 *  factor across two sessions) then lands around ~8-10 calf set-equivalents —
 *  which matches how demanding that actually is, without drowning out lifting. */
export const SETS_PER_SPORT_LOAD = 4;

/** Per-session sport muscle load, already duration-scaled (see health/exercise
 *  sessionMuscleLoad): { date, load: { Calves: 1.05, Quads: 1.05, ... } }. */
export interface ActivityLoad { date: string; load: Record<string, number> }

function statusFor(sets: number): VolumeStatus {
  if (sets === 0) return 'none';
  if (sets < SET_MIN_STIMULUS) return 'low';
  if (sets > SET_CEILING) return 'high';
  if (sets >= SET_FLOOR) return 'optimal';
  return 'low'; // between MIN_STIMULUS and FLOOR — some stimulus, still under target
}

/** A working set: both reps and a positive load logged (bodyweight moves that
 *  log reps with null weight still count as a set — reps present is enough). */
function isWorkingSet(s: { reps: number | null; weight_kg: number | null }): boolean {
  return s != null && s.reps != null && s.reps > 0;
}

/**
 * @param logs        Every logged session (date, exercise_name, sets).
 * @param groupsFor   Resolver: exercise name -> the muscle groups it trains.
 *                    A compound counts toward EACH group it hits (that's how
 *                    weekly volume is actually accrued).
 * @param groups      The canonical group list to grade (so an untouched muscle
 *                    still shows up as neglected rather than silently missing).
 * @param opts.windowDays  Rolling window, default 7.
 * @param opts.asOf   ISO/YMD "today"; defaults to the latest log date.
 */
export function muscleVolume(
  logs: StrengthLog[],
  groupsFor: (exerciseName: string, muscleText?: string) => string[],
  groups: string[],
  opts: { windowDays?: number; asOf?: string; activity?: ActivityLoad[] } = {},
): VolumeReport {
  const windowDays = opts.windowDays ?? 7;
  const activity = opts.activity ?? [];
  const allDates = [...logs.map((l) => l.date), ...activity.map((a) => a.date)].filter(Boolean).sort();
  const asOf = opts.asOf || allDates[allDates.length - 1];
  const liftCounts = new Map<string, number>();
  const sportCounts = new Map<string, number>();
  for (const g of groups) { liftCounts.set(g, 0); sportCounts.set(g, 0); }

  if (asOf) {
    const cutoff = shiftDays(asOf, -(windowDays - 1));
    // Logged lifting: each working set counts once per muscle the lift trains.
    for (const log of logs) {
      if (!log.date || log.date < cutoff || log.date > asOf) continue;
      const working = (log.sets || []).filter(isWorkingSet).length;
      if (working === 0) continue;
      for (const g of groupsFor(log.exercise_name)) {
        if (liftCounts.has(g)) liftCounts.set(g, (liftCounts.get(g) || 0) + working);
      }
    }
    // Sport/activity: convert each session's per-muscle load into set-equivalents.
    for (const a of activity) {
      if (!a.date || a.date < cutoff || a.date > asOf) continue;
      for (const [muscle, load] of Object.entries(a.load || {})) {
        if (sportCounts.has(muscle)) sportCounts.set(muscle, (sportCounts.get(muscle) || 0) + load * SETS_PER_SPORT_LOAD);
      }
    }
  }

  const perMuscle: MuscleVolume[] = groups.map((group) => {
    const liftSets = liftCounts.get(group) || 0;
    const sportSets = Math.round((sportCounts.get(group) || 0) * 10) / 10;
    const sets = Math.round((liftSets + sportSets) * 10) / 10;
    const status = statusFor(sets);
    const gap = status === 'low' || status === 'none' ? Math.max(0, SET_FLOOR - sets)
      : status === 'high' ? sets - SET_CEILING : 0;
    return { group, sets, liftSets, sportSets, status, gap };
  });

  const undertrained = perMuscle.filter((m) => m.status === 'none' || m.status === 'low').map((m) => m.group);
  const overreaching = perMuscle.filter((m) => m.status === 'high').map((m) => m.group);
  const totalSets = Math.round(perMuscle.reduce((a, m) => a + m.sets, 0) * 10) / 10;
  const sportSets = Math.round(perMuscle.reduce((a, m) => a + m.sportSets, 0) * 10) / 10;

  let headline: string | null = null;
  if (totalSets === 0) headline = null;
  else if (undertrained.length > 0) {
    const worst = perMuscle.filter((m) => m.status !== 'high').sort((a, b) => a.sets - b.sets).slice(0, 2).map((m) => m.group);
    headline = `Under the ~${SET_FLOOR}-set weekly floor: ${worst.join(' & ')}. Add a set or two there.`;
  } else if (overreaching.length > 0) {
    headline = `${overreaching.join(' & ')} above ~${SET_CEILING} sets — plenty; make sure recovery keeps up.`;
  } else {
    headline = 'Every muscle is inside the productive weekly range. Hold this.';
  }

  return { windowDays, perMuscle, undertrained, overreaching, totalSets, sportSets, headline };
}

function shiftDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}
