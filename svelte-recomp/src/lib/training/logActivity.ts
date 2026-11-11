/**
 * Hand-logging a session the watch didn't catch.
 *
 * THE GAP THIS FILLS: sport only ever entered the app through Health Connect.
 * Play badminton without the watch — flat battery, left on the charger, forgot
 * to start a session, a companion app that never synced — and as far as the app
 * was concerned it never happened. Muscle recovery stayed full, training load
 * read low, and the readiness card cheerfully recommended legs the next morning.
 *
 * A manual row is deliberately the SAME shape as a watch row, with the same
 * `exercise_type` code, so everything downstream — sessionMuscleLoad,
 * activityLoadAU, the recovery grid, the history feed — treats it identically
 * without a single branch. The only difference is `source`, which exists so the
 * Health Connect sync knows not to delete rows it did not create.
 */
import { supabase } from '$lib/db/client';
import db from '$lib/db/dexie';
import { EXERCISE_TYPES, QUICK_ACTIVITIES, type ActivitySession } from './exercise';
import { todayYmd } from '$lib/date';


/** Rough kcal/min by activity kind — only used when the user gives no watch data. */
const KCAL_PER_MIN: Record<string, number> = {
  sport: 8,
  cardio: 9,
  strength: 6,
  mind: 3,
  other: 6,
};

export { QUICK_ACTIVITIES };

export interface ManualActivityInput {
  uid: string;
  exerciseType: number;
  durationMin: number;
  /** YMD. Defaults to today. */
  date?: string;
  /** Optional — if omitted, estimated from duration and activity kind. */
  activeKcal?: number | null;
}

/**
 * Write a hand-logged session. Returns the row that was stored.
 *
 * The id is derived from (user, date, type, duration-bucket) rather than random,
 * so double-tapping "I played badminton" twice in a row updates one row instead
 * of doubling the day's training load. Logging a genuinely separate second
 * session of the same sport on the same day still works — it lands in a
 * different minute bucket via the start time.
 */
export async function logManualActivity(input: ManualActivityInput): Promise<ActivitySession> {
  const { uid, exerciseType, durationMin } = input;
  if (!uid) throw new Error('Not signed in');
  if (!(durationMin > 0)) throw new Error('Duration must be more than zero');

  const date = input.date || todayYmd();
  const meta = EXERCISE_TYPES[exerciseType] || { label: 'Workout', emoji: '🏋️', kind: 'other' as const };

  // Anchor the session to the end of the logged day when back-filling, and to
  // "just finished" when it is today — the exact clock time is unknowable after
  // the fact, and pretending otherwise would put fake precision into the
  // recovery model's hours-since-trained maths.
  const end = date === todayYmd() ? new Date() : new Date(`${date}T18:00:00`);
  const start = new Date(end.getTime() - durationMin * 60000);

  const kcal =
    input.activeKcal != null
      ? input.activeKcal
      : Math.round(durationMin * (KCAL_PER_MIN[meta.kind] ?? 6));

  const row: ActivitySession = {
    id: `manual-${uid}-${date}-${exerciseType}-${start.getHours()}${String(start.getMinutes()).padStart(2, '0')}`,
    user_id: uid,
    date,
    exercise_type: exerciseType,
    label: meta.label,
    emoji: meta.emoji,
    kind: meta.kind,
    start: start.toISOString(),
    end: end.toISOString(),
    duration_min: durationMin,
    active_kcal: kcal,
    distance_m: null,
    avg_hr: null,
    source: 'manual',
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('activity_sessions').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  await db.table('activity_sessions').put(JSON.parse(JSON.stringify(row)));
  return row;
}

export async function deleteManualActivity(id: string): Promise<void> {
  await db.table('activity_sessions').delete(id);
  const { error } = await supabase.from('activity_sessions').delete().eq('id', id);
  if (error) throw error;
}
