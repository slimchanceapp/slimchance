// "Talk to your coach" (Pact m49, his ask 19 Nov: "you should be able to talk to
// the coach just like I am with you"). The coach may propose changes to the
// person's own week; this decides which ones may be shown as a card. Each card
// saves only when they tap it (src/routes/coach). Pure; checked in selfcheck.js.
//
// What it may propose: swap an exercise in one of their sessions for another by
// name, move one of their sessions to another day, put their sport on a day,
// or remember something about them. Never a load, a count, a new session or a
// session on their sport's day.

export type CoachAction =
  | { type: 'swap_exercise'; session: string; from: string; to: string }
  | { type: 'move_session'; session: string; to_day: number } // 0 = Sunday, as Date.getDay()
  | { type: 'set_sport'; day: number; sport: string }
  | { type: 'remember'; note: string };

/** Their week as the coach sees it: sessions with exercise names, and each day. */
export interface ChatWeek {
  sessions: { name: string; exercises: string[] }[];
  days: { dow: number; session: string | null; sport: string | null }[];
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** An exercise or a sport: words only, never a load or a count. */
const NAME = /^[A-Za-z][A-Za-z '’()+&/-]{1,47}$/;
const same = (a: unknown, b: string) => String(a ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase();
/** Names as cards show them: "badminton" reads "Badminton". */
const titled = (t: string) => t.replace(/(^|[\s(/-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());

/** "Tue", "tuesday" or 2 as Date.getDay(); null for anything else. */
export function dayIndex(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 6 ? v : null;
  const s = String(v ?? '').trim().toLowerCase();
  const i = DAY_NAMES.findIndex((d) => s.length >= 3 && d.toLowerCase().startsWith(s));
  return i < 0 ? null : i;
}

export function checkActions(raw: unknown, week: ChatWeek): { actions: CoachAction[]; dropped: string[] } {
  const actions: CoachAction[] = [];
  const dropped: string[] = [];
  const session = (n: unknown) => week.sessions.find((s) => same(n, s.name));
  for (const a of (Array.isArray(raw) ? raw : []).slice(0, 3) as any[]) {
    const t = a?.type;
    if (t === 'swap_exercise') {
      const s = session(a.session);
      if (!s) { dropped.push(`"${String(a.session ?? '')}" isn't one of their sessions`); continue; }
      const from = s.exercises.find((e) => same(a.from, e));
      if (!from) { dropped.push(`"${String(a.from ?? '')}" isn't in ${s.name}`); continue; }
      const to = titled(String(a.to ?? '').trim().replace(/\s+/g, ' '));
      if (!NAME.test(to)) { dropped.push(`"${to}": the new exercise must be a name, never a load or a count`); continue; }
      if (same(to, from)) { dropped.push(`${from} is already in ${s.name}`); continue; }
      actions.push({ type: 'swap_exercise', session: s.name, from, to });
    } else if (t === 'move_session') {
      const s = session(a.session);
      if (!s) { dropped.push(`"${String(a.session ?? '')}" isn't one of their sessions`); continue; }
      const to = dayIndex(a.to_day);
      if (to === null) { dropped.push(`"${String(a.to_day ?? '')}" isn't a day of the week`); continue; }
      const there = week.days.find((d) => d.dow === to);
      if (there?.sport) { dropped.push(`${DAY_NAMES[to]} is their ${there.sport} day: never a session on it`); continue; }
      if (week.days.some((d) => d.dow === to && d.session && same(d.session, s.name))) { dropped.push(`${s.name} is already on ${DAY_NAMES[to]}`); continue; }
      actions.push({ type: 'move_session', session: s.name, to_day: to });
    } else if (t === 'set_sport') {
      const day = dayIndex(a.day);
      const sport = titled(String(a.sport ?? '').trim().replace(/\s+/g, ' '));
      if (day === null) { dropped.push(`"${String(a.day ?? '')}" isn't a day of the week`); continue; }
      if (!NAME.test(sport) || sport.length > 30) { dropped.push(`"${sport}" isn't a sport's name`); continue; }
      actions.push({ type: 'set_sport', day, sport });
    } else if (t === 'remember') {
      const note = String(a.note ?? '').trim().replace(/\s+/g, ' ');
      if (note.length < 3 || note.length > 160) { dropped.push('a note to remember is a short sentence'); continue; }
      actions.push({ type: 'remember', note });
    } else {
      dropped.push(`"${String(t ?? '')}" is not something the coach can change`);
    }
  }
  return { actions, dropped };
}

/** How a change reads on its card. */
export function describe(a: CoachAction, week?: ChatWeek): string {
  switch (a.type) {
    case 'swap_exercise': return `Swap ${a.from} for ${a.to} in ${a.session}`;
    case 'move_session': return `Move ${a.session} to ${DAY_NAMES[a.to_day]}`;
    case 'set_sport': {
      const was = week?.days.find((d) => d.dow === a.day)?.session;
      return `${a.sport} on ${DAY_NAMES[a.day]}s${was ? ` (instead of ${was})` : ''}`;
    }
    case 'remember': return `Remember: ${a.note}`;
  }
}
