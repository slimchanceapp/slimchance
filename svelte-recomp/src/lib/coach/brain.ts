// THE COACH'S BRAIN: what the app says tonight, decided by an AI from the
// person's own numbers, and what it has learned about them so far.
//
// Asked for on 2026-10-28: an app that learns the person, mimics them and
// corrects them, and "other than forcing my hand, it should basically do
// everything else". The rules that keep that safe live here, pure and tested:
//   - the AI sees only the app's own numbers (stores/body is the one source
//     of truth), never computes a target of its own;
//   - everything it writes is checked before a word is shown: a number that
//     isn't in its facts, a word from the shaming list, or a repeat of a recent
//     evening, and the app's own plain message stands instead;
//   - it may choose silence: a day that needs nothing gets nothing.
// I/O lives in stores/brain.ts, the prompt in supabase/functions/coach.

import { holdAfter } from '../moments/index.ts';

export interface DayRow {
  date: string; dow: string;
  /** That morning's weigh-in in the person's unit, or null. */
  weight: number | null;
  kcal: number | null; protein: number | null; items: number;
  trained: boolean;
  /** Minutes the watch recorded that day. */
  watchMin: number;
}

export interface BrainFacts {
  units: string;
  now: { date: string; time: string; dow: string };
  /** Loss per week is POSITIVE when losing, as everywhere in the app. */
  trend: { now: number | null; lossPerWeek: number | null; pace: string; goal: number | null };
  today: {
    kcal: number; protein: number;
    budget: number | null; budgetLeft: number | null;
    proteinTarget: number | null; proteinLeft: number | null;
    trained: boolean; session: string | null;
  };
  /** The last 14 days, oldest first, today last. */
  days: DayRow[];
  plans: Record<string, string>;
  why: string | null;
  usualFoods: string[];
  recentEvenings: string[];
  notes: string | null;
}

/** Flat, so Gemini's response schema stays simple: empty strings mean "none". */
export interface BrainReply {
  send_evening: boolean;
  evening_title: string;
  evening_body: string;
  noticed_title: string;
  noticed_body: string;
  notes: string;
}

export interface FactsInput {
  now: Date;
  units: string;
  /** kg into the person's unit. */
  toUnit: (kg: number) => number;
  trend: { kg: number | null; lossPerWeekKg: number | null; pace: string; goalKg: number | null };
  intake: Map<string, { kcal: number; protein: number; items: number }>;
  weights: Array<{ date: string; weight: number }>;
  trained: Set<string>;
  watchMinutes: Map<string, number>;
  budget: number | null;
  proteinTarget: number | null;
  session: string | null;
  plans: Record<string, string> | null;
  why: string | null;
  usualFoods: string[];
  recentEvenings: string[];
  notes: string | null;
}

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildFacts(i: FactsInput): BrainFacts {
  const today = ymd(i.now);
  const days: DayRow[] = [];
  for (let back = 13; back >= 0; back--) {
    const d = new Date(i.now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - back);
    const date = ymd(d);
    const food = i.intake.get(date);
    const w = i.weights.find((x) => x.date === date);
    days.push({
      date, dow: DOW[d.getDay()],
      weight: w ? r1(i.toUnit(+w.weight)) : null,
      kcal: food ? Math.round(food.kcal) : null,
      protein: food ? Math.round(food.protein) : null,
      items: food?.items ?? 0,
      trained: i.trained.has(date),
      watchMin: Math.round(i.watchMinutes.get(date) ?? 0),
    });
  }
  const t = days[days.length - 1];
  const kcal = t.kcal ?? 0, protein = t.protein ?? 0;
  return {
    units: i.units,
    now: { date: today, time: `${String(i.now.getHours()).padStart(2, '0')}:${String(i.now.getMinutes()).padStart(2, '0')}`, dow: DOW[i.now.getDay()] },
    trend: {
      now: i.trend.kg != null ? r1(i.toUnit(i.trend.kg)) : null,
      lossPerWeek: i.trend.lossPerWeekKg != null ? r1(i.toUnit(i.trend.lossPerWeekKg)) : null,
      pace: i.trend.pace,
      goal: i.trend.goalKg != null ? r1(i.toUnit(i.trend.goalKg)) : null,
    },
    today: {
      kcal, protein,
      budget: i.budget != null ? Math.round(i.budget) : null,
      budgetLeft: i.budget != null ? Math.max(0, Math.round(i.budget - kcal)) : null,
      proteinTarget: i.proteinTarget != null ? Math.round(i.proteinTarget) : null,
      proteinLeft: i.proteinTarget != null ? Math.max(0, Math.round(i.proteinTarget - protein)) : null,
      trained: t.trained, session: i.session,
    },
    days,
    plans: i.plans ?? {},
    why: i.why?.trim() || null,
    usualFoods: i.usualFoods.slice(0, 8),
    recentEvenings: i.recentEvenings.slice(-7),
    notes: i.notes?.trim() || null,
  };
}

/** Every number written in a text: "2,269 kcal" is 2269, "21:00" is 21 and 0. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => parseFloat(m[0].replace(/,(?=\d{3}(?:\D|$))/g, '')));
}

export const LIMITS = { title: 60, body: 280, noticed: 360, notes: 900 };

/** What a coach in this app never says, whatever it was asked or tricked into.
 *  A reply that says any of it is dropped whole and the app's own plain
 *  message stands. Matched on everything shown, notes included. */
export const NEVER: Array<[string, RegExp]> = [
  // Loss aversion and guilt: what turns one meal into a lost week.
  ['streaks and guilt', /\b(streaks?|cheat(?:s|ing|ed)?|guilt(?:y)?|punish\w*|deserve\w*|naughty|you failed|make up for|burn(?: \w+)? off|work (?:it|that|this) off|earn (?:it|your|a|the) )/i],
  // Eating-disorder territory: starving, purging, skipping, pills.
  ['starving or purging', /\b(starv\w*|purg\w*|vomit\w*|laxatives?|diet pills?|appetite suppress\w*|stop eating|eat nothing|eat less than|water fast\w*|skip (?:a |the |your |tonight's )?(?:meal|dinner|lunch|breakfast|food))/i],
  // Faster isn't safer, and pain is the program's to judge.
  ['pushing past limits', /\b(lose (?:it |weight )?faster|push (?:harder|through)|through the pain|no pain)/i],
  // Insults about a body or a person.
  ['insults', /\b(you(?:'re| are) (?:fat|weak|disgusting|pathetic|a failure)|lazy|disgust\w*|pathetic|ugly)/i],
  // The budget is learned to work with however someone logs, so a coach never
  // asks for more logging: more days, more items, more completely.
  ['asking for more logging', /\b(?:try|start|keep|consider|could|might|should|just|even)\b[^.\n]{0,40}\b(?:log(?:ging|ged)?|(?<!on )track(?:ing)?|record(?:ing)?)\b/i],
  // Medicine is a doctor's: no doses, diagnoses or prescriptions.
  ['medical advice', /\b(dos(?:e|es|age)|diagnos\w*|prescri\w*|medication)\b/i],
];

/** Counts a coach can work out from 14 days of rows (3 mornings, 2 sessions). */
const FREE_UNDER = 14;

export type Checked = { ok: true; reply: BrainReply } | { ok: false; why: string };

export function checkReply(raw: unknown, facts: BrainFacts): Checked {
  const r = raw as Partial<BrainReply> | null;
  if (!r || typeof r !== 'object' || typeof r.send_evening !== 'boolean') return { ok: false, why: 'not a reply' };
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const reply: BrainReply = {
    send_evening: r.send_evening,
    evening_title: s(r.evening_title), evening_body: s(r.evening_body),
    noticed_title: s(r.noticed_title), noticed_body: s(r.noticed_body),
    notes: s(r.notes),
  };
  if (reply.send_evening && (!reply.evening_title || !reply.evening_body)) return { ok: false, why: 'an evening with nothing in it' };
  if (reply.evening_title.length > LIMITS.title || reply.noticed_title.length > LIMITS.title) return { ok: false, why: 'title too long' };
  if (reply.evening_body.length > LIMITS.body) return { ok: false, why: 'evening too long' };
  if (reply.noticed_body.length > LIMITS.noticed) return { ok: false, why: 'noticed too long' };
  if (reply.notes.length > LIMITS.notes) return { ok: false, why: 'notes too long' };

  const shown = [reply.evening_title, reply.evening_body, reply.noticed_title, reply.noticed_body].join('\n');
  for (const [what, rx] of NEVER) {
    const bad = rx.exec(`${shown}\n${reply.notes}`);
    if (bad) return { ok: false, why: `${what}: "${bad[0].trim()}"` };
  }

  const known = numbersIn(JSON.stringify(facts));
  for (const n of numbersIn(`${shown}\n${reply.notes}`)) {
    if (n <= FREE_UNDER) continue;
    if (!known.some((k) => Math.abs(k - n) <= Math.max(1, Math.abs(k) * 0.01))) return { ok: false, why: `${n} isn't in its facts` };
  }

  const wrongDay = misnamedDay(`${shown}\n${reply.notes}`, +facts.now.date.slice(0, 4));
  if (wrongDay) return { ok: false, why: `${wrongDay} is the wrong weekday` };

  // A session still to come, on a day with none or one already done: the
  // reminder this whole thing exists to stop. (Live red team, 2026-10-28: "You
  // have a session remaining for today" on a rest day.)
  if (reply.send_evening && (!facts.today.session || facts.today.trained) && SESSION_AHEAD.test(`${reply.evening_title}\n${reply.evening_body}`)) {
    return { ok: false, why: 'a session that isn\'t there' };
  }

  // The evening note shows from holdAfter() on, so a clock time before that,
  // or a session "ahead" that starts before it, has passed when it's read
  // (2026-11-10: "a notification that I have a workout at 5.30pm, at 7.30pm").
  if (reply.send_evening) {
    const opens = holdAfter(new Date(`${facts.now.date}T12:00:00`).getDay());
    const evening = `${reply.evening_title}\n${reply.evening_body}`;
    const past = clockTimes(evening).find((t) => t.minutes < opens && !t.tomorrow);
    if (past) return { ok: false, why: `${past.text} will have passed by the evening` };
    const at = clockTimes(facts.today.session ?? '')[0];
    if (at && at.minutes < opens && namedAhead(facts.today.session!).test(evening)) return { ok: false, why: 'a session that will be over by the evening' };
  }

  const said = reply.evening_body.toLowerCase();
  if (reply.send_evening && facts.recentEvenings.some((e) => e.toLowerCase().includes(said) || said.includes(e.toLowerCase()))) {
    return { ok: false, why: 'a repeat of a recent evening' };
  }
  return { ok: true, reply };
}

/** Clock times in a text ("17:30", "5.30pm", "6pm"), in minutes from
 *  midnight, and whether "tomorrow" comes just before. */
export function clockTimes(text: string): Array<{ text: string; minutes: number; tomorrow: boolean }> {
  const out: Array<{ text: string; minutes: number; tomorrow: boolean }> = [];
  for (const m of text.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b|\b(\d{1,2})[:.](\d{2})\b/gi)) {
    let h = +(m[1] ?? m[4]);
    const min = +(m[2] ?? m[5] ?? 0);
    const ap = m[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) continue;
    out.push({ text: m[0], minutes: h * 60 + min, tomorrow: /tomorrow/i.test(text.slice(Math.max(0, (m.index ?? 0) - 30), m.index)) });
  }
  return out;
}

/** The day's own session ("Gym 17:30" by its label, or as a session, workout
 *  or gym) spoken of as still to come; "rest counts as training tonight" isn't. */
function namedAhead(session: string): RegExp {
  const label = session.replace(/\s*\d{1,2}[:.]\d{2}.*$/, '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = String.raw`(?:${label ? `${label}|` : ''}session|workout|gym)`;
  return new RegExp(String.raw`\b${named}\b[^.\n]{0,40}\b${AHEAD}|\b${AHEAD}\b[^.\n]{0,25}\b${named}\b`, 'i');
}

const SESSION = String.raw`(?:session|workout|training|gym|badminton|game|match|lift(?:ing)?)`;
const AHEAD = String.raw`(?:ahead|tonight|remaining|left to|waiting|coming up|later today|still on|still to)`;
const SESSION_AHEAD = new RegExp(String.raw`\b${SESSION}\b[^.\n]{0,40}\b${AHEAD}|\b${AHEAD}\b[^.\n]{0,25}\b${SESSION}\b`, 'i');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTH = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE = String.raw`(\d{4})-(\d{2})-(\d{2})|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})`;
const WEEKDAY = String.raw`(mon|tues|wednes|thurs|fri|satur|sun)day`;

/** A weekday named next to a date it doesn't fall on ("Wednesday 2026-10-15",
 *  "Oct 15 (Wednesday)"): the slip that makes a coach sound like it wasn't
 *  looking. Returns the offending text, or null. */
export function misnamedDay(text: string, year: number): string | null {
  const check = (m: RegExpMatchArray, dayAt: number, dateAt: number): string | null => {
    const [y, mo, d] = m[dateAt]
      ? [+m[dateAt], +m[dateAt + 1] - 1, +m[dateAt + 2]]
      : [year, MONTH.indexOf(m[dateAt + 3].toLowerCase()), +m[dateAt + 4]];
    const real = new Date(y, mo, d, 12).getDay();
    return DAYS.indexOf(m[dayAt].slice(0, 3).toLowerCase()) === real ? null : m[0];
  };
  for (const m of text.matchAll(new RegExp(String.raw`\b${WEEKDAY},?\s+(?:${DATE})`, 'gi'))) {
    const bad = check(m, 1, 2); if (bad) return bad;
  }
  for (const m of text.matchAll(new RegExp(String.raw`(?:${DATE})\s*\(${WEEKDAY}\)`, 'gi'))) {
    const bad = check(m, 6, 1); if (bad) return bad;
  }
  return null;
}

/** Tonight's message: the brain's when it wrote one, nothing when it chose
 *  silence, the app's own when there is no checked reply. */
export function eveningFrom<T extends { date: string; title: string; body: string }>(hold: T, reply: BrainReply | null): T | null {
  if (!reply) return hold;
  if (!reply.send_evening) return null;
  return { ...hold, title: reply.evening_title, body: reply.evening_body };
}

/** What would make the morning's reply stale: training done since, or a
 *  meal's worth of food logged. A new digest is a reason to ask again. */
export function factsDigest(f: BrainFacts): string {
  // Protein too: a shake changes the evening's message without moving the
  // calories much (2026-11-10: a protein note after the target was hit).
  return `${f.today.trained ? 1 : 0}:${Math.round(f.today.kcal / 300)}:${Math.round(f.today.protein / 20)}`;
}
