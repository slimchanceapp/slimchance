// Changes to the person's own training week, saved as they accepted them in
// Talk to your coach (src/routes/coach): swap an exercise by name, move a
// session to another day, put their sport on a day. The coach's checks
// (src/lib/coach/chat.ts) come first.
//
// Each change writes the whole week (or every session) in one request, all or
// nothing (upsertRecords): until someone has saved their own, the app shows a
// default week, and saving one day alone would leave the others behind.
import { upsertRecords } from '$lib/stores/sync';
import type { PlanDay, PlanSession } from './data/workoutPlanDefaults';

const stamp = () => new Date().toISOString();
const rest = (dow: number): PlanDay => ({ day_of_week: dow, label: 'Rest', session_key: null, note: '', time: null });

/** All seven days, those not set up as rest. */
const sevenDays = (week: PlanDay[]): PlanDay[] => Array.from({ length: 7 }, (_, dow) => week.find((d) => d.day_of_week === dow) ?? rest(dow));

async function saveWeek(uid: string, days: PlanDay[]): Promise<void> {
  await upsertRecords('workout_schedule', days.map((d) => ({
    user_id: uid, day_of_week: d.day_of_week, label: d.label, note: d.note ?? '', session_key: d.session_key, time: d.time ?? null, updated_at: stamp(),
  })));
}

/** One exercise swapped by name in one session. Its tip and video belonged to the old one. */
export async function swapExercise(uid: string, sessions: PlanSession[], name: string, from: string, to: string): Promise<void> {
  const rows = sessions.map((s) => (s.name !== name ? s : {
    ...s, exercises: s.exercises.map((e) => (e.name === from ? { ...e, name: to, tip: '', vid: undefined } : e)),
  }));
  await upsertRecords('workout_sessions_custom', rows.map((s) => ({ user_id: uid, ...s, updated_at: stamp() })));
}

/** A session moves to another day; whatever was on that day takes its old one. */
export async function moveSession(uid: string, week: PlanDay[], sessionKey: string, toDow: number): Promise<void> {
  const days = sevenDays(week);
  const from = days.find((d) => d.session_key === sessionKey);
  if (!from || from.day_of_week === toDow) return;
  const to = days[toDow];
  await saveWeek(uid, days.map((d) =>
    d.day_of_week === from.day_of_week ? { ...to, day_of_week: d.day_of_week }
    : d.day_of_week === toDow ? { ...from, day_of_week: toDow } : d));
}

/** Their sport on a day (as sportOf reads it). It counts as training, and the day keeps its time. */
export async function setSportDay(uid: string, week: PlanDay[], dow: number, sport: string): Promise<void> {
  await saveWeek(uid, sevenDays(week).map((d) => (d.day_of_week !== dow ? d
    : { ...d, label: 'Cardio & Agility', note: `${sport} — counts as training`, session_key: null })));
}
