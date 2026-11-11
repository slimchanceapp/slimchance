/**
 * Exercise-session intelligence (pure, testable).
 *
 * The OnePlus watch (via OHealth → Health Connect) records every workout and
 * badminton match as an `ExerciseSession` with a start/end and an
 * `exerciseType` code, plus separate `ActiveCaloriesBurned` / `Distance`
 * records over the same window. This module turns those raw Health Connect
 * records into normalized `ActivitySession` rows the app can show and coach on:
 * it labels the activity, matches the calories/distance that overlap each
 * session, and de-dupes overlapping duplicates (OHealth sometimes writes the
 * same match twice, or a manual + auto copy).
 *
 * It is deliberately free of Dexie / Capacitor imports so it can be unit
 * tested and reused on any platform.
 */

export type ActivityKind = 'sport' | 'cardio' | 'strength' | 'mind' | 'other';

export interface ActivitySession {
  id: string;
  user_id: string;
  date: string; // YMD of the session start (local)
  exercise_type: number;
  label: string;
  emoji: string;
  kind: ActivityKind;
  start: string; // ISO
  end: string; // ISO
  duration_min: number;
  active_kcal: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  /**
   * 'watch' rows are rebuilt from Health Connect on every sync and are deleted
   * when they leave the watch's set. 'manual' rows are the user's own record of
   * a session the watch missed, and are never touched by the sync.
   */
  source: 'watch' | 'manual';
  updated_at: string;
}

type Meta = { label: string; emoji: string; kind: ActivityKind };

/**
 * Health Connect `ExerciseSessionRecord.EXERCISE_TYPE_*` codes → friendly meta.
 * (Values are the stable androidx.health.connect exercise-type integers.)
 */
export const EXERCISE_TYPES: Record<number, Meta> = {
  0: { label: 'Workout', emoji: '🏋️', kind: 'other' },
  2: { label: 'Badminton', emoji: '🏸', kind: 'sport' },
  4: { label: 'Baseball', emoji: '⚾', kind: 'sport' },
  5: { label: 'Basketball', emoji: '🏀', kind: 'sport' },
  8: { label: 'Cycling', emoji: '🚴', kind: 'cardio' },
  9: { label: 'Cycling (indoor)', emoji: '🚴', kind: 'cardio' },
  10: { label: 'Boot camp', emoji: '🥾', kind: 'cardio' },
  11: { label: 'Boxing', emoji: '🥊', kind: 'sport' },
  13: { label: 'Calisthenics', emoji: '🤸', kind: 'strength' },
  14: { label: 'Cricket', emoji: '🏏', kind: 'sport' },
  16: { label: 'Dancing', emoji: '💃', kind: 'cardio' },
  25: { label: 'Elliptical', emoji: '🏃', kind: 'cardio' },
  26: { label: 'Exercise class', emoji: '🧎', kind: 'cardio' },
  27: { label: 'Fencing', emoji: '🤺', kind: 'sport' },
  31: { label: 'Frisbee', emoji: '🥏', kind: 'sport' },
  32: { label: 'Golf', emoji: '⛳', kind: 'sport' },
  33: { label: 'Breathing', emoji: '🧘', kind: 'mind' },
  34: { label: 'Gymnastics', emoji: '🤸', kind: 'sport' },
  35: { label: 'Handball', emoji: '🤾', kind: 'sport' },
  36: { label: 'HIIT', emoji: '🔥', kind: 'cardio' },
  37: { label: 'Hiking', emoji: '🥾', kind: 'cardio' },
  38: { label: 'Ice hockey', emoji: '🏒', kind: 'sport' },
  39: { label: 'Ice skating', emoji: '⛸️', kind: 'sport' },
  44: { label: 'Martial arts', emoji: '🥋', kind: 'sport' },
  46: { label: 'Paddling', emoji: '🛶', kind: 'cardio' },
  48: { label: 'Pilates', emoji: '🧘', kind: 'mind' },
  50: { label: 'Racquetball', emoji: '🎾', kind: 'sport' },
  51: { label: 'Rock climbing', emoji: '🧗', kind: 'strength' },
  53: { label: 'Rowing', emoji: '🚣', kind: 'cardio' },
  54: { label: 'Rowing machine', emoji: '🚣', kind: 'cardio' },
  55: { label: 'Rugby', emoji: '🏉', kind: 'sport' },
  56: { label: 'Running', emoji: '🏃', kind: 'cardio' },
  57: { label: 'Treadmill', emoji: '🏃', kind: 'cardio' },
  58: { label: 'Sailing', emoji: '⛵', kind: 'sport' },
  60: { label: 'Skating', emoji: '⛸️', kind: 'sport' },
  61: { label: 'Skiing', emoji: '⛷️', kind: 'sport' },
  62: { label: 'Snowboarding', emoji: '🏂', kind: 'sport' },
  64: { label: 'Soccer', emoji: '⚽', kind: 'sport' },
  65: { label: 'Softball', emoji: '🥎', kind: 'sport' },
  66: { label: 'Squash', emoji: '🎾', kind: 'sport' },
  68: { label: 'Stair climbing', emoji: '🪜', kind: 'cardio' },
  69: { label: 'Stair machine', emoji: '🪜', kind: 'cardio' },
  70: { label: 'Strength training', emoji: '🏋️', kind: 'strength' },
  71: { label: 'Stretching', emoji: '🤸', kind: 'mind' },
  72: { label: 'Surfing', emoji: '🏄', kind: 'sport' },
  73: { label: 'Swimming', emoji: '🏊', kind: 'cardio' },
  74: { label: 'Swimming (pool)', emoji: '🏊', kind: 'cardio' },
  75: { label: 'Table tennis', emoji: '🏓', kind: 'sport' },
  76: { label: 'Tennis', emoji: '🎾', kind: 'sport' },
  78: { label: 'Volleyball', emoji: '🏐', kind: 'sport' },
  79: { label: 'Walking', emoji: '🚶', kind: 'cardio' },
  80: { label: 'Water polo', emoji: '🤽', kind: 'sport' },
  81: { label: 'Weightlifting', emoji: '🏋️', kind: 'strength' },
  83: { label: 'Yoga', emoji: '🧘', kind: 'mind' }
};

export function describeExercise(type: number): Meta {
  return EXERCISE_TYPES[type] || { label: 'Workout', emoji: '💪', kind: 'other' };
}

function ymdLocal(d: string | number | Date): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** ms of overlap between [aS,aE] and [bS,bE]. */
function overlapMs(aS: number, aE: number, bS: number, bE: number): number {
  return Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
}

type Interval = { startTime: any; endTime: any };

/**
 * Energy (kcal) or distance over [start,end] that does NOT double-count
 * OVERLAPPING records. Health Connect very often holds the same burn twice —
 * two apps writing it, or a per-session record plus a rolling background series
 * covering the same minutes. The old sum added both, so a real 302 kcal workout
 * was stored as 604. Overlapping records describe the SAME minutes, so within a
 * cluster of overlapping records we keep the largest contribution; genuinely
 * separate (non-touching) periods still add, so granular per-minute buckets
 * sum correctly. Touching intervals ([0,1],[1,2]) are treated as separate.
 */
function overlapDedupSum(
  start: number,
  end: number,
  records: Interval[],
  pick: (r: any) => number | null | undefined
): number | null {
  const segs: Array<{ s: number; e: number; val: number }> = [];
  for (const r of records) {
    const rS = new Date(r.startTime).getTime();
    const rE = new Date(r.endTime).getTime();
    const ov = overlapMs(start, end, rS, rE);
    if (ov <= 0) continue;
    const val = Number(pick(r));
    if (!isFinite(val)) continue;
    const span = Math.max(1, rE - rS);
    segs.push({ s: Math.max(start, rS), e: Math.min(end, rE), val: val * (ov / span) });
  }
  if (segs.length === 0) return null;
  segs.sort((a, b) => a.s - b.s);
  let total = 0;
  let curEnd = -Infinity;
  let curMax = 0;
  let open = false;
  for (const seg of segs) {
    if (!open || seg.s >= curEnd) {
      // disjoint from the current cluster → bank the previous cluster's max, open a new one
      if (open) total += curMax;
      curMax = seg.val;
      curEnd = seg.e;
      open = true;
    } else {
      // overlaps the current cluster → same burn measured twice; keep the larger
      curMax = Math.max(curMax, seg.val);
      curEnd = Math.max(curEnd, seg.e);
    }
  }
  if (open) total += curMax;
  return total;
}

export interface BuildInput {
  uid: string;
  exercises: any[];
  activeCals?: any[];
  totalCals?: any[];
  distances?: any[];
  hrSeries?: any[];
  now?: number;
}

/**
 * Normalize raw Health Connect records into `ActivitySession` rows, matching
 * calories/distance/HR by time overlap and de-duplicating near-identical
 * sessions (same type, starts within 5 min → keep the longer one).
 */
export function buildActivitySessions(input: BuildInput): ActivitySession[] {
  const { uid, exercises } = input;
  const activeCals = input.activeCals || [];
  const totalCals = input.totalCals || [];
  const distances = input.distances || [];
  const hrSeries = input.hrSeries || [];
  const nowISO = new Date(input.now ?? Date.now()).toISOString();

  const raw: ActivitySession[] = [];
  for (const ex of exercises) {
    const start = new Date(ex.startTime).getTime();
    const end = new Date(ex.endTime).getTime();
    if (!isFinite(start) || !isFinite(end) || end <= start) continue;
    const durMin = Math.round((end - start) / 60000);
    if (durMin < 1) continue;

    const type = Number(ex.exerciseType) || 0;
    const meta = describeExercise(type);

    // Prefer active calories; fall back to total. Overlap-dedup so two writers
    // (or a session record + a background series) can't double the burn.
    let kcal = overlapDedupSum(start, end, activeCals, (r) => r?.energy?.value);
    if (kcal == null) kcal = overlapDedupSum(start, end, totalCals, (r) => r?.energy?.value);

    const distM = overlapDedupSum(start, end, distances, (r) => r?.distance?.value);

    // Average HR from any heart-rate series samples inside the window.
    let hrSum = 0;
    let hrN = 0;
    for (const series of hrSeries) {
      for (const s of series?.samples || []) {
        const t = new Date(s.time).getTime();
        if (t >= start && t <= end) {
          const bpm = Number(s.beatsPerMinute);
          if (bpm > 0) {
            hrSum += bpm;
            hrN++;
          }
        }
      }
    }

    raw.push({
      id: `${new Date(start).toISOString()}::${type}`,
      user_id: uid,
      date: ymdLocal(start),
      exercise_type: type,
      label: (ex.title && String(ex.title).trim()) || meta.label,
      emoji: meta.emoji,
      kind: meta.kind,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      duration_min: durMin,
      active_kcal: kcal != null ? Math.round(kcal) : null,
      distance_m: distM != null ? Math.round(distM) : null,
      avg_hr: hrN ? Math.round(hrSum / hrN) : null,
      source: 'watch',
      updated_at: nowISO
    });
  }

  // De-dupe by TIME OVERLAP, not by start proximity.
  //
  // A genuine duplicate (OHealth writing the same match twice, or the watch and
  // the phone both recording it) covers essentially the same window, so it
  // overlaps almost completely. The old rule — "same type, starts within 5 min"
  // — also silently deleted a REAL second session: play two 40-minute badminton
  // matches back to back and the second one vanished, taking its calories and
  // its recovery cost with it. Requiring >70% overlap of the shorter session
  // keeps distinct sessions and still collapses true copies.
  raw.sort((a, b) => a.start.localeCompare(b.start));
  const kept: ActivitySession[] = [];
  for (const s of raw) {
    const sS = new Date(s.start).getTime();
    const sE = new Date(s.end).getTime();
    const dup = kept.find((k) => {
      if (k.exercise_type !== s.exercise_type) return false;
      const kS = new Date(k.start).getTime();
      const kE = new Date(k.end).getTime();
      const ov = overlapMs(sS, sE, kS, kE);
      const shorter = Math.min(sE - sS, kE - kS);
      return shorter > 0 && ov / shorter > 0.7;
    });
    if (!dup) {
      kept.push(s);
      continue;
    }
    if (s.duration_min > dup.duration_min) {
      kept[kept.indexOf(dup)] = s;
    }
  }
  return kept;
}

// — Watch activity → muscle recovery + training load —
//
// WHY THIS EXISTS: the gym tab's recovery grid and its acute:chronic training-
// load ratio were both computed from `workout_logs` alone — the sets you type in
// by hand. Watch-recorded sessions were read, stored and then used only to
// render a display list. So two hours of badminton (relentless lunging, jumping
// and overhead swings) contributed exactly zero fatigue: quads and calves read
// "Ready" the next morning, and the injury-risk ratio was blind to a third of
// the real training week. These tables are what let sport count.

/** Fraction of a full resistance-training stimulus this sport applies to a muscle. */
export type MuscleLoad = Record<string, number>;

/**
 * Per-exercise-type muscle involvement, 0..1, where 1.0 ≈ a hard direct set for
 * that muscle. Values reflect how much ECCENTRIC/damaging work the tissue takes,
 * which is what drives recovery time — badminton hammers quads and calves via
 * deceleration and lunging, but only lightly loads the shoulder despite the
 * overhead action.
 *
 * Deliberately omitted: strength training (70) and weightlifting (81). The watch
 * cannot tell which muscles a lifting session hit, and you already log those
 * sets by hand — attributing them here would double-count the exact same work.
 * They still contribute to overall training load below.
 */
/**
 * The activities worth one tap. Deliberately short: this is the "the watch
 * missed it" path, not a workout encyclopedia. Every code is a real Health
 * Connect EXERCISE_TYPE, so a manual badminton row and a watch badminton row
 * are indistinguishable to the recovery model.
 */
export const QUICK_ACTIVITIES: number[] = [
  2,   // Badminton
  76,  // Tennis
  56,  // Running
  8,   // Cycling
  73,  // Swimming
  79,  // Walking
  5,   // Basketball
  64,  // Soccer
  37,  // Hiking
  83,  // Yoga
];

export const ACTIVITY_MUSCLE_LOAD: Record<number, MuscleLoad> = {
  2:  { Quads: 0.7, Calves: 0.7, Hamstrings: 0.35, Glutes: 0.4, Shoulders: 0.3, Core: 0.3 },   // Badminton
  50: { Quads: 0.7, Calves: 0.7, Hamstrings: 0.35, Glutes: 0.4, Shoulders: 0.3, Core: 0.3 },   // Racquetball
  66: { Quads: 0.7, Calves: 0.7, Hamstrings: 0.35, Glutes: 0.4, Shoulders: 0.3, Core: 0.3 },   // Squash
  76: { Quads: 0.6, Calves: 0.6, Hamstrings: 0.35, Glutes: 0.4, Shoulders: 0.3, Core: 0.3 },   // Tennis
  75: { Quads: 0.2, Calves: 0.2, Shoulders: 0.2, Core: 0.1 },                // Table tennis
  5:  { Quads: 0.7, Calves: 0.7, Hamstrings: 0.4, Glutes: 0.4, Core: 0.3 },  // Basketball
  64: { Quads: 0.7, Hamstrings: 0.6, Calves: 0.6, Glutes: 0.5, Core: 0.3 },  // Soccer
  56: { Quads: 0.6, Hamstrings: 0.5, Calves: 0.8, Glutes: 0.4, Core: 0.2 },  // Running
  57: { Quads: 0.5, Hamstrings: 0.4, Calves: 0.7, Glutes: 0.3, Core: 0.2 },  // Treadmill
  37: { Quads: 0.6, Calves: 0.6, Glutes: 0.5, Hamstrings: 0.3 },             // Hiking
  79: { Calves: 0.2, Quads: 0.15, Glutes: 0.1 },                             // Walking
  8:  { Quads: 0.6, Glutes: 0.4, Calves: 0.3 },                              // Cycling
  9:  { Quads: 0.6, Glutes: 0.4, Calves: 0.3 },                              // Cycling (indoor)
  25: { Quads: 0.4, Glutes: 0.4, Calves: 0.3, Hamstrings: 0.2 },             // Elliptical
  68: { Quads: 0.6, Glutes: 0.6, Calves: 0.5 },                              // Stair climbing
  69: { Quads: 0.6, Glutes: 0.6, Calves: 0.5 },                              // Stair machine
  73: { Back: 0.5, Shoulders: 0.5, Chest: 0.3, Core: 0.3, Triceps: 0.2 },    // Swimming
  74: { Back: 0.5, Shoulders: 0.5, Chest: 0.3, Core: 0.3, Triceps: 0.2 },    // Swimming (pool)
  53: { Back: 0.6, Quads: 0.5, Biceps: 0.4, Core: 0.3 },                     // Rowing
  54: { Back: 0.6, Quads: 0.5, Biceps: 0.4, Core: 0.3 },                     // Rowing machine
  51: { Back: 0.6, Biceps: 0.6, Shoulders: 0.4, Core: 0.4 },                 // Rock climbing
  11: { Shoulders: 0.5, Core: 0.5, Calves: 0.4, Back: 0.3 },                 // Boxing
  44: { Shoulders: 0.4, Core: 0.5, Quads: 0.4, Calves: 0.4 },                // Martial arts
  36: { Quads: 0.6, Glutes: 0.5, Core: 0.5, Chest: 0.3, Shoulders: 0.3 },    // HIIT
  10: { Quads: 0.5, Glutes: 0.4, Core: 0.4, Chest: 0.3, Shoulders: 0.3 },    // Boot camp
  13: { Chest: 0.5, Triceps: 0.5, Core: 0.5, Shoulders: 0.4, Back: 0.3 },    // Calisthenics
  16: { Quads: 0.4, Calves: 0.4, Glutes: 0.3, Core: 0.2 },                   // Dancing
  34: { Core: 0.5, Shoulders: 0.4, Quads: 0.3 },                             // Gymnastics
  35: { Quads: 0.5, Calves: 0.5, Shoulders: 0.3, Core: 0.3 },                // Handball
  78: { Quads: 0.5, Calves: 0.5, Shoulders: 0.4, Core: 0.3 },                // Volleyball
  55: { Quads: 0.6, Hamstrings: 0.5, Calves: 0.5, Core: 0.4 }                // Rugby
};

/**
 * How much muscle load a specific session applied, scaled by its duration.
 *
 * A 20-minute knock-about and a two-hour league night should not cost the same
 * recovery. One hour is the reference; the scale is clamped to 0.5–1.5 so a
 * marathon session can't claim an absurd multiple and a short one still counts.
 */
export function sessionMuscleLoad(session: {
  exercise_type: number;
  duration_min: number;
}): MuscleLoad {
  const base = ACTIVITY_MUSCLE_LOAD[session.exercise_type];
  if (!base) return {};
  const durationFactor = Math.max(0.5, Math.min(1.5, (session.duration_min || 0) / 60));
  const out: MuscleLoad = {};
  for (const [muscle, load] of Object.entries(base)) out[muscle] = load * durationFactor;
  return out;
}

/**
 * Perceived intensity (RPE 1–10) for a watch session, used for session-RPE
 * training load (Foster et al. 2001: load = duration × RPE).
 *
 * Heart rate is the honest signal when the watch recorded it, so it wins. The
 * bands below are a deliberately simple ladder rather than a %HRmax formula,
 * because we have no reliable age/HRmax here and a wrong HRmax is worse than a
 * coarse band. `hrBands` is exposed so it can be calibrated per person later —
 * a fit user's easy pace sits at a heart rate that would be hard for someone
 * else, and no fixed table gets that right for everyone.
 */
export function sessionRpe(
  session: { kind: ActivityKind; avg_hr?: number | null },
  hrBands: Array<[number, number]> = [
    [100, 3],
    [120, 5],
    [140, 6.5],
    [160, 8],
    [Infinity, 9.5]
  ]
): number {
  const hr = session.avg_hr;
  if (hr != null && hr > 0) {
    for (const [ceiling, rpe] of hrBands) if (hr < ceiling) return rpe;
  }
  // No HR — fall back to what the activity type typically demands.
  switch (session.kind) {
    case 'sport':
      return 7;
    case 'cardio':
      return 6;
    case 'strength':
      return 7;
    case 'mind':
      return 2.5;
    default:
      return 5;
  }
}

/**
 * Is this watch session the SAME workout the user already logged by hand?
 *
 * THE DOUBLE-ENTRY PROBLEM. Someone who wears a watch to the gym AND types in
 * their sets produces two records of one session. The watch's is a duration and
 * a heart rate; theirs is the actual sets and weights. Counting both inflates
 * training load on exactly the days that matter most.
 *
 * The old guard was `kind === 'strength'`, which misses the common case: real
 * watches label a gym session `EXERCISE_TYPE_OTHER_WORKOUT` (0) — "Overall
 * fitness" on a Galaxy Watch — not "Strength training" (70). Type 0 maps to
 * kind `'other'`, sailed past the guard, and got added on top of the hand-logged
 * sets. Every gym session recorded on this account came through as type 0.
 *
 * The rule that actually holds:
 *   - `strength` — always a duplicate of hand-logged sets. Drop it.
 *   - `other` — ambiguous. It's a duplicate ONLY if sets were logged that day;
 *     otherwise it's a real workout the user didn't write down, and it counts.
 *   - everything else (`sport`, `cardio`, `mind`) — never hand-logged as sets.
 *     A badminton night still counts in full, which is the whole point of
 *     reading sessions off the watch.
 *
 * Deliberately date-level, not timestamp-level: a set log carries a date, not a
 * session window, so there is nothing finer to match on. Two genuinely separate
 * workouts on one day (lift in the morning, spin class at night) would collapse
 * into one only if the watch labelled the second one `other` as well.
 */
export function isSameSessionAsLogged(
  session: { kind: ActivityKind; date: string },
  handLoggedDates: Set<string>
): boolean {
  if (session.kind === 'strength') return true;
  if (session.kind === 'other') return handLoggedDates.has(session.date);
  return false;
}

/** Session-RPE training load in arbitrary units (duration × RPE). */
export function activityLoadAU(session: {
  kind: ActivityKind;
  duration_min: number;
  avg_hr?: number | null;
}): number {
  return (session.duration_min || 0) * sessionRpe(session);
}

/** Total active calories from watch sessions on a given day. */
export function dayActiveKcal(sessions: ActivitySession[], date: string): number {
  return sessions
    .filter((s) => s.date === date && s.active_kcal != null)
    .reduce((sum, s) => sum + (s.active_kcal || 0), 0);
}

/** A day with this many watch minutes trained; a 3-minute badminton blip or a
 *  20-minute ride to work didn't. Minutes add up across a day, because the
 *  watch files one game as several short sessions. ponytail: one cut-off for
 *  every kind; give each kind its own if a real short session gets missed. */
export const TRAINED_MIN = 25;

/** Every date the person trained: a plan session marked done, TRAINED_MIN
 *  watch minutes, or a set with reps typed in. The one definition: Today, its
 *  coach line, the training-day nudge, Workouts, the scale-up explainer and
 *  the stall check all ask this. */
export function trainedDates(
  completions: Array<{ date?: string | null }>,
  activities: Array<{ date?: string | null; duration_min?: number | null }>,
  logs: Array<{ date?: string | null; sets?: any[] | null }>,
): Set<string> {
  const out = new Set<string>();
  for (const c of completions) if (c.date) out.add(c.date);
  const minutes = new Map<string, number>();
  for (const a of activities) if (a.date) minutes.set(a.date, (minutes.get(a.date) ?? 0) + (+(a.duration_min ?? 0) || 0));
  for (const [d, m] of minutes) if (m >= TRAINED_MIN) out.add(d);
  for (const l of logs) if (l.date && (l.sets ?? []).some((s: any) => s?.reps > 0)) out.add(l.date);
  return out;
}

/** The most significant watch session for a day (longest duration). */
export function primaryActivity(
  sessions: ActivitySession[],
  date: string
): ActivitySession | null {
  const day = sessions.filter((s) => s.date === date);
  if (!day.length) return null;
  return day.reduce((best, s) => (s.duration_min > best.duration_min ? s : best), day[0]);
}
