// Remembering: the journal the Sunday check-in writes, a week at a time, and
// the letter from last month. Remembering is what keeping weight off runs on.
// Its own module (2026-11-11): the morning moments load at startup and read
// the month letter, so it must not drag the whole weekly review in with it.
// Pure; checked in selfcheck.js.

import { weightVerdict, type WeighIn } from './body/index.ts';

const DAY_MS = 86400000;

// ---------------------------------------------------------------------------
// Week by week: the journal the Sunday check-in writes, a line at a time
// ---------------------------------------------------------------------------

export interface JournalWeek {
  /** Monday the check-in was filed under. */
  weekStart: string;
  /** The trend at that week's end, and its change from the week before. */
  trendKg: number | null;
  deltaKg: number | null;
  /** The plan reviewed that week, in the words it had then. */
  planText: string | null;
  held: 'kept' | 'mostly' | 'not this time' | null;
  note: string | null;
}

const HELD = { nailed: 'kept', mostly: 'mostly', struggled: 'not this time' } as const;

/** Every answered week, newest first: the trend, the plan and how it held,
 *  and the user's own line. Built from what the check-in already stores. */
export function journalWeeks(dailyLogs: Array<{ date: string; week_check?: any }>, weights: WeighIn[], limit = 12): JournalWeek[] {
  const weeks = (dailyLogs ?? []).filter((l) => l?.week_check?.effort).sort((a, b) => a.date.localeCompare(b.date));
  let prev: number | null = null;
  const out: JournalWeek[] = [];
  for (const l of weeks) {
    const sunday = Date.parse(`${l.date}T12:00:00`) + 6 * DAY_MS;
    const trendKg = weightVerdict(weights, sunday)?.trendKg ?? null;
    const c = l.week_check;
    out.push({
      weekStart: l.date, trendKg,
      deltaKg: trendKg != null && prev != null ? Math.round((trendKg - prev) * 10) / 10 : null,
      planText: c.planText ?? null,
      held: c.planText ? HELD[c.adherence as keyof typeof HELD] ?? null : null,
      note: c.note?.trim() || null,
    });
    if (trendKg != null) prev = trendKg;
  }
  return out.reverse().slice(0, limit);
}

// ---------------------------------------------------------------------------
// The letter from last month: the journal, a month at a time
// ---------------------------------------------------------------------------

export interface MonthLetter {
  /** YYYY-MM, and its name. */
  month: string;
  label: string;
  /** The trend at the month's start and end (first and last day with one). */
  fromKg: number | null;
  toKg: number | null;
  deltaKg: number | null;
  /** Mornings weighed, of the month's days. */
  mornings: number;
  days: number;
  /** Weeks whose reviewed plan held (kept or mostly), of those reviewed. */
  kept: number;
  reviewed: number;
  /** The user's own Sunday lines, in order. */
  notes: Array<{ weekStart: string; note: string }>;
  /** Next stops reached that month. */
  stops: Array<{ kg: number; reached: string }>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The month before the one `today` is in, as YYYY-MM. */
export function lastMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * A month, told back: what the trend did, how often the scale was met, how
 * the plans held, and the user's own words from each Sunday. Only from what
 * the app already stores; null when the month left nothing to tell.
 */
export function monthLetter(
  month: string,
  dailyLogs: Array<{ date: string; week_check?: any }>,
  weights: WeighIn[],
  stops: Array<{ kg: number; reached: string }> = [],
): MonthLetter | null {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const inMonth = (ymd: string) => ymd.startsWith(month);
  // From the month's first weigh-in to its last: a trend read on a day with
  // no weigh-in near it would be an extrapolation, not a reading.
  const dates = [...new Set(weights.filter((w) => inMonth(w.date)).map((w) => w.date))].sort();
  const trendOn = (ymd: string) => weightVerdict(weights, Date.parse(`${ymd}T12:00:00`))?.trendKg ?? null;
  let fromKg: number | null = null, toKg: number | null = null;
  for (let i = 0; i < dates.length && fromKg == null; i++) fromKg = trendOn(dates[i]);
  for (let i = dates.length - 1; i >= 0 && toKg == null; i--) toKg = trendOn(dates[i]);
  const weeks = (dailyLogs ?? []).filter((l) => inMonth(l.date) && l?.week_check?.effort).sort((a, b) => a.date.localeCompare(b.date));
  const reviewed = weeks.filter((l) => l.week_check.planText);
  const letter: MonthLetter = {
    month, label: MONTHS[m - 1],
    fromKg: fromKg != null ? Math.round(fromKg * 10) / 10 : null,
    toKg: toKg != null ? Math.round(toKg * 10) / 10 : null,
    deltaKg: fromKg != null && toKg != null ? Math.round((toKg - fromKg) * 10) / 10 : null,
    mornings: dates.length,
    days,
    kept: reviewed.filter((l) => ['nailed', 'mostly'].includes(l.week_check.adherence)).length,
    reviewed: reviewed.length,
    notes: weeks.filter((l) => l.week_check.note?.trim()).map((l) => ({ weekStart: l.date, note: l.week_check.note.trim() })),
    stops: stops.filter((s) => inMonth(s.reached)),
  };
  return letter.mornings || letter.reviewed || letter.notes.length || letter.stops.length ? letter : null;
}
