// The coach brain's I/O: when to ask, what to send, where the reply lives.
// The rules are pure in $lib/brain; the prompt is supabase/functions/coach.
//
// It asks only when the person turned the coach on (user_settings.coach.on),
// only from 15:00 (the evening's message is what it writes), and again the
// same day only when the day changed under it (training done since, a meal's
// worth logged), at most three times. Whatever fails, the app's own plain
// messages stand: no reply is never worse than the app without the coach.
import { derived, get, writable, type Readable } from 'svelte/store';
import { supabase } from '$lib/db/client';
import { body } from './body';
import { liveActivitySessions, liveFoodLogs, liveProfile, liveSchedule, liveSessionCompletions, liveWeights, liveWorkoutLogs } from './live';
import { upsertRecord } from './sync';
import { PRIVACY_VERSION, userId } from './user';
import { buildFacts, checkReply, factsDigest, type BrainReply } from '$lib/brain';
import { trainedDates } from '$lib/health/exercise';
import { cleanPlans } from '$lib/plans';
import { frequentFoods } from '$lib/quickAdd';
import { toUnit, weightUnit } from '$lib/units';

const KEY = 'recompos.brain';
const AFTER = 15 * 60;
const MAX_TRIES = 3;
const GAP_MS = 20 * 60_000;

interface Saved { date: string; digest: string; reply: BrainReply | null; tries: number; at: number; history: string[]; note: string | null }

function load(): Saved | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
const saved = writable<Saved | null>(typeof localStorage === 'undefined' ? null : load());
function keep(s: Saved) {
  saved.set(s);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* the reply still shows this session */ }
}

const coachOf = (p: any) => (p?.coach && typeof p.coach === 'object' ? p.coach : {}) as { on?: boolean; notes?: string | null; at?: string; privacy?: string };

export const coachOn: Readable<boolean> = derived(liveProfile(), ($p) => !!coachOf($p).on);
export const coachNotes: Readable<string | null> = derived(liveProfile(), ($p) => coachOf($p).notes ?? null);

/** Today's checked reply, or null: none yet, it failed, or it's another day's. */
export const brainToday: Readable<BrainReply | null> = derived([saved, body, coachOn], ([$s, $b, $on]) =>
  $on && $s?.date === $b.today ? $s.reply : null);

/** Why the last ask didn't give a reply, in words for Settings, or null. */
export const brainNote: Readable<string | null> = derived(saved, ($s) => $s?.note ?? null);

let running = false;

export async function runBrainIfDue(now = new Date()): Promise<void> {
  if (running || !get(coachOn) || now.getHours() * 60 + now.getMinutes() < AFTER) return;
  const b = get(body);
  const profile = get(liveProfile()) as any;
  const activity = (get(liveActivitySessions()) as any[]) ?? [];
  const food = (get(liveFoodLogs()) as any[]) ?? [];
  const watchMinutes = new Map<string, number>();
  for (const a of activity) if (a.date) watchMinutes.set(a.date, (watchMinutes.get(a.date) ?? 0) + (+a.duration_min || 0));
  const day = ((get(liveSchedule()) as any[]) ?? []).find((s) => s.day_of_week === now.getDay());
  const s0 = get(saved);
  const facts = buildFacts({
    now, units: weightUnit(), toUnit: (kg) => toUnit(kg),
    trend: { kg: b.weight?.trendKg ?? b.currentKg, lossPerWeekKg: b.weight?.rateKgPerWeek ?? null, pace: b.pace, goalKg: b.goalKg },
    intake: b.intake as any,
    weights: ((get(liveWeights()) as any[]) ?? []).map((w) => ({ date: w.date, weight: +w.weight })),
    trained: trainedDates((get(liveSessionCompletions()) as any[]) ?? [], activity, (get(liveWorkoutLogs()) as any[]) ?? []),
    watchMinutes,
    budget: b.week?.share ?? null,
    proteinTarget: b.proteinTargetG ?? null,
    session: day?.time ? `${day.label ?? 'Training'} ${day.time}${day.note ? ` (${day.note})` : ''}` : null,
    plans: cleanPlans(profile?.plans) as any,
    why: profile?.why ?? null,
    usualFoods: frequentFoods(food, 8).map((f) => f.name),
    recentEvenings: s0?.history ?? [],
    notes: coachOf(profile).notes ?? null,
  });
  const digest = factsDigest(facts);
  const same = s0?.date === facts.now.date;
  if (same && s0!.digest !== digest && (s0!.tries >= MAX_TRIES || Date.now() - s0!.at < GAP_MS)) {
    // The day has moved on (food, protein, training) and the coach can't be
    // asked again yet: its text is out of date, so the app's own words stand
    // in until it can (2026-11-10).
    if (s0!.reply) keep({ ...s0!, reply: null });
    return;
  }
  if (same && s0!.digest === digest) return;

  running = true;
  try {
    const { data, error } = await supabase.functions.invoke('coach', { body: { facts }, timeout: 50_000 });
    const checked = !error && data?.reply
      ? checkReply(data.reply, facts)
      : { ok: false as const, why: (data?.error as string) || 'unreachable' };
    const history = [...(s0?.history ?? [])];
    if (checked.ok && checked.reply.send_evening) history.push(checked.reply.evening_body);
    keep({
      date: facts.now.date, digest, at: Date.now(),
      tries: (same ? s0!.tries : 0) + 1,
      // A failed second ask keeps the first one's reply.
      reply: checked.ok ? checked.reply : same ? s0!.reply : null,
      history: history.slice(-7),
      note: checked.ok ? null : /paid tier/.test(checked.why) ? checked.why : 'The coach couldn’t answer this time; today’s messages are the app’s own.',
    });
    if (checked.ok && checked.reply.notes) await saveCoach({ notes: checked.reply.notes, notes_at: new Date().toISOString() });
    if (!checked.ok) console.warn('[brain] no reply:', checked.why);
  } finally {
    running = false;
  }
}

async function saveCoach(patch: Record<string, unknown>): Promise<void> {
  const uid = get(userId);
  if (!uid) throw new Error('Not signed in — sign back in.');
  const coach = { ...coachOf(get(liveProfile())), ...patch };
  await upsertRecord('user_settings', { user_id: uid, coach, updated_at: new Date().toISOString() });
}

/** The person's consent, recorded with the privacy page it was given against. */
export async function setCoach(on: boolean): Promise<void> {
  await saveCoach(on ? { on, at: new Date().toISOString(), privacy: PRIVACY_VERSION } : { on });
}

/** Forget what the coach has learned, here and in the account. */
export async function forgetCoach(): Promise<void> {
  await saveCoach({ notes: null, notes_at: null });
  try { localStorage.removeItem(KEY); } catch { /* nothing kept */ }
  saved.set(null);
}
