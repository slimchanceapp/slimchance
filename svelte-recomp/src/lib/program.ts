// ponytail: inert since 2026-11-11. Nothing can start a program any more (Google
// Play counts rehabilitation as a medical feature, which needs an organization
// account), and nobody had one running. Retire this with its readers (coach,
// body, Train, the morning rating) once the program's future is decided.
// Training programs that temporarily take over the gym days — pure logic,
// covered by scripts/selfcheck.js.
//
// A program never edits the user's own plan. It OVERLAYS it: the sessions
// store hands every consumer (Today, Train, nudges, recovery) the program's
// session for each scheduled gym day while the program runs, and the user's
// own sessions come back untouched the day it ends. Their weekday schedule —
// which days are gym, which are badminton — is respected as is.

import type { PlanDay, PlanSession } from './data/workoutPlanDefaults.ts';
import { PHASES, WEEKS, type ProgramPhase } from './data/backRebuild.ts';

export type ProgramState = { id: 'back-rebuild'; start: string } | null | undefined;

const dayNum = (ymd: string) => Math.floor(Date.parse(ymd + 'T00:00:00Z') / 86_400_000);
const fromDayNum = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** 0 before the start date, 1…WEEKS while running, WEEKS + 1 once finished. */
export function programWeek(p: ProgramState, today: string): number {
  if (!p?.start) return 0;
  const days = dayNum(today) - dayNum(p.start);
  if (days < 0) return 0;
  return Math.min(WEEKS + 1, Math.floor(days / 7) + 1);
}

/**
 * The program is in charge: from the week before it starts (when its first
 * sessions are already shown; see overlaySessions) until it ends. While it is,
 * loads are set by the morning back rating, so nothing should judge them
 * against the old heavy training: no "strength slipping", no "volume down".
 */
export function programActive(p: ProgramState, today: string): boolean {
  if (!p?.start) return false;
  const week = programWeek(p, today);
  return (week >= 1 && week <= WEEKS) || (week === 0 && dayNum(p.start) - dayNum(today) <= 7);
}

/** The program's rule for a badminton day while it's in charge, so the
 *  briefing, the evening hold and Today never say "Badminton 18:15" in a
 *  fortnight the plan says no games. Null when no program is active. */
export function badmintonRule(p: ProgramState, date: string): { text: string; play: boolean } | null {
  if (!programActive(p, date)) return null;
  const phase = phaseFor(Math.max(1, programWeek(p, date)));
  return phase ? { text: phase.badmintonShort, play: phase.play } : null;
}

/** The last day of the program, YYYY-MM-DD. */
export const programEnd = (p: NonNullable<ProgramState>) => shiftStart(p.start, WEEKS * 7 - 1);

export function phaseFor(week: number): ProgramPhase | null {
  return PHASES.find((ph) => week >= ph.weeks[0] && week <= ph.weeks[1]) ?? null;
}

/** The Monday on or after `today` — a program starts on a fresh week. */
export function nextMonday(today: string): string {
  const n = dayNum(today);
  const dow = new Date(n * 86_400_000).getUTCDay(); // 0 = Sunday
  return fromDayNum(n + (dow === 1 ? 0 : (8 - dow) % 7));
}

export const shiftStart = (start: string, days: number) => fromDayNum(dayNum(start) + days);

/** Distinct gym session keys in week order, Monday first. */
export function gymKeysInOrder(schedule: PlanDay[]): string[] {
  const keys = [...schedule]
    .filter((d) => d.session_key)
    .sort((a, b) => ((a.day_of_week + 6) % 7) - ((b.day_of_week + 6) % 7))
    .map((d) => d.session_key as string);
  return keys.filter((k, i) => keys.indexOf(k) === i);
}

/**
 * The user's sessions with the program's swapped in: the first gym day of the
 * week gets session A, the next B, then C, then A again. In the week before
 * the start date the phase-1 sessions are already shown — nobody returning
 * from an injury should be shown their old heavy session the day before.
 */
export function overlaySessions(
  base: Map<string, PlanSession>, schedule: PlanDay[], p: ProgramState, today: string,
): Map<string, PlanSession> {
  if (!p?.start) return base;
  const raw = programWeek(p, today);
  const week = raw === 0 && dayNum(p.start) - dayNum(today) <= 7 ? 1 : raw;
  const phase = phaseFor(week);
  const keys = gymKeysInOrder(schedule);
  if (!phase || !keys.length) return base;
  const out = new Map(base);
  keys.forEach((key, i) => {
    const s = phase.sessions[i % phase.sessions.length];
    out.set(key, { ...s, key, program: { name: 'Back Rebuild', week, weekInPhase: week - phase.weeks[0] + 1 } });
  });
  return out;
}

export type PainEntry = { date: string; back_pain?: number | null };
export type Advice = { tone: 'good' | 'warn' | 'bad' | 'na'; title: string; body: string; ratedToday: boolean; physio: boolean };

/**
 * The traffic light, from the morning ratings. Red on 6+; amber on 4–5 or on
 * a rise to 3+ (worse than yesterday is the classic "too much, too soon"
 * signal); green otherwise.
 */
export function painAdvice(entries: PainEntry[], today: string): Advice {
  const rated = entries
    .filter((e) => typeof e.back_pain === 'number' && e.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = rated[rated.length - 1];
  const ratedToday = last?.date === today;
  if (!last) return { tone: 'na', title: 'How are the back and neck this morning?', body: 'Rate it each morning, 0–10. The plan paces itself on it.', ratedToday, physio: false };
  const now = last.back_pain as number;
  const prev = rated.length > 1 ? (rated[rated.length - 2].back_pain as number) : null;
  // "Not settling within a week" as a rule, not a sentence: 6+ on five of the
  // last seven mornings. Past that point the plan stops offering to wait.
  const weekAgo = shiftStart(today, -6);
  const badDays = rated.filter((e) => e.date >= weekAgo && (e.back_pain as number) >= 6).length;
  if (badDays >= 5) {
    return { tone: 'bad', ratedToday, physio: true, title: `6+ on ${badDays} of the last 7 mornings — see a physio`,
      body: 'It isn’t settling on its own. Get it assessed before you load it. Until then: walk, and the daily basics only if they’re comfortable.' };
  }
  if (now >= 6) {
    return { tone: 'bad', ratedToday, physio: false, title: `Back at ${now}/10 — back off`,
      body: 'No loaded hinges or squats today. Walk, do the daily basics if they’re comfortable, and rate it again tomorrow. Not settling within a week? See a physio.' };
  }
  if (now >= 4 || (prev != null && now > prev && now >= 3)) {
    return { tone: 'warn', ratedToday, physio: false, title: `Back at ${now}/10 — hold here`,
      body: 'Train, but don’t progress: keep this week’s loads (or take 20% off) and repeat the week if it stays here.' };
  }
  return { tone: 'good', ratedToday, physio: false, title: `Back at ${now}/10 — green`,
    body: 'Follow the plan. Add load next session only if every set felt like 3/10 or less.' };
}
