// "Is it working?": the person's first two weeks against their last two, in
// their own numbers (planned 2026-10-18 as the owner's before-and-after; built
// 2026-11-11 for everyone). It says what changed, never why: their own data can
// show the first, not the second. Behaviour comes first and the scale last, and
// nothing here praises a weight (teach and be kind). Pure; the trend is the
// app's one trend (weightVerdict as of a date), never a fit of its own.

import { weightVerdict } from './insights.ts';
import { shiftYmd } from './date.ts';

export interface Period {
  from: string; to: string;
  /** Mornings weighed, days with food logged, days trained, out of 14. */
  weighed: number; logged: number; trained: number;
  /** The trend's pace at the end of the period, kg a week, losing positive; null before there's one. */
  pace: { kgPerWeek: number; lo: number; hi: number } | null;
}

export interface SinceStart { first: Period; recent: Period; habit: string | null }

const DAYS = 14;
const noon = (ymd: string) => new Date(`${ymd}T12:00:00`);
const within = (d: string, from: string, to: string) => d >= from && d <= to;

/** Null until four weeks have passed since the first weigh-in: two weeks to
 *  each side, so the two periods never share a day. */
export function sinceStart(i: {
  today: string;
  weights: Array<{ date: string; weight: number }>;
  logged: string[];
  trained: Iterable<string>;
}): SinceStart | null {
  const dates = i.weights.map((w) => w.date).filter(Boolean).sort();
  const start = dates[0];
  if (!start || shiftYmd(2 * DAYS - 1, noon(start)) > i.today) return null;
  const trained = [...i.trained];
  const period = (from: string, to: string): Period => {
    const v = weightVerdict(i.weights.filter((w) => w.date <= to), Date.parse(`${to}T12:00:00`));
    const hasPace = v != null && v.state !== 'not-enough' && v.state !== 'too-noisy';
    return {
      from, to,
      weighed: new Set(dates.filter((d) => within(d, from, to))).size,
      logged: new Set(i.logged.filter((d) => within(d, from, to))).size,
      trained: new Set(trained.filter((d) => within(d, from, to))).size,
      pace: hasPace ? { kgPerWeek: v!.rateKgPerWeek, lo: v!.loKgPerWeek, hi: v!.hiKgPerWeek } : null,
    };
  };
  const first = period(start, shiftYmd(DAYS - 1, noon(start)));
  const recent = period(shiftYmd(-(DAYS - 1), noon(i.today)), i.today);
  // The habit that moved most, in words; a change of one or two days is noise.
  const moves: Array<[string, number]> = [
    ['weigh in', recent.weighed - first.weighed],
    ['log your food', recent.logged - first.logged],
    ['train', recent.trained - first.trained],
  ];
  const [what, by] = moves.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const habit = Math.abs(by) < 3 ? null : by > 0 ? `You ${what} more often than in your first two weeks.` : `You ${what} less often than in your first two weeks.`;
  return { first, recent, habit };
}
