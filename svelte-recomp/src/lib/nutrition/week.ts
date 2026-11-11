// The week as the unit of eating: one budget, Monday to Sunday.
//
// A daily target turns one big meal into a lost day, and a lost day is how one
// big meal becomes a big weekend — "the diet's broken anyway". A weekly budget
// makes the same meal a cost: a big Saturday leaves less for Sunday, it doesn't
// break anything. Pure; see selfcheck.js.

import { mondayOf } from '../date.ts';
import { fitWeightLine, type WeighIn } from '../body/index.ts';

export interface WeekBudget {
  start: string;
  /** target × 7. */
  budget: number;
  /** Logged Monday..today. */
  logged: number;
  /** Monday..yesterday as eaten: what was logged, and the target for a day
   *  with nothing logged. What today's share is worked out from. */
  before: number;
  /** Days left including today. */
  daysLeft: number;
  /** What's left, spread evenly over the days left. */
  share: number;
}

export function weekBudget(target: number | null, intake: Map<string, { kcal: number }>, today: string): WeekBudget | null {
  if (target == null || target <= 0) return null;
  const at = new Date(`${today}T12:00:00`);
  const start = mondayOf(at);
  let logged = 0, before = 0, daysLogged = 0;
  for (const [d, v] of intake) {
    if (d < start || d > today) continue;
    logged += v.kcal;
    if (d < today) { before += v.kcal; daysLogged++; }
  }
  const daysLeft = 7 - ((at.getDay() + 6) % 7);
  // A day with nothing logged is unknown, not a day without food: it counts
  // at the target, neither room nor debt. Counted as zero, a week of weigh-ins
  // and no food log read "0 of 5,719 kcal" on a Saturday (2026-10-31).
  before += target * (7 - daysLeft - daysLogged);
  const budget = target * 7;
  return { start, budget, logged: Math.round(logged), before: Math.round(before), daysLeft, share: Math.round((budget - before) / daysLeft) };
}

// ---------------------------------------------------------------------------
// The week's shape: where in it the food goes, and what the scale does with it
// ---------------------------------------------------------------------------


export interface WeekShape {
  /** Median logged kcal per weekday, Monday first. */
  kcal: number[];
  /** That weekday's mornings against the local trend, kg, Monday first; null
   *  where there are too few mornings to say. */
  scale: (number | null)[];
  /** Median logged day Monday–Thursday, and Friday–Sunday. */
  weekdayKcal: number;
  weekendKcal: number;
  /** weekendKcal − weekdayKcal, kcal a day. */
  weekendGap: number;
  /** Weekday index (0 = Monday) the scale reads heaviest / lightest; null without scale data. */
  heaviest: number | null;
  lightest: number | null;
}

const DAY_MS = 86400000;
const monFirst = (d: string) => (new Date(`${d}T12:00:00`).getDay() + 6) % 7;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Twelve weeks folded onto one: the median logged day for each weekday, and
 * how each weekday's mornings sit against the local trend (a line through the
 * three weeks around each one, so a cut or a gain doesn't read as a rhythm).
 *
 * Most people's weeks have a shape — the weekend eats more and the scale shows
 * it two days later — and seeing your own is what turns "the weekend" from a
 * vague guilt into a number with a plan attached. null until every weekday has
 * at least four logged days behind it.
 */
export function weekShape(intake: Map<string, { kcal: number }>, weights: WeighIn[], today: string, days = 84): WeekShape | null {
  const end = Date.parse(`${today}T12:00:00`);
  const recent = (d: string) => { const t = Date.parse(`${d}T12:00:00`); return t <= end && t > end - days * DAY_MS; };

  const byDay: number[][] = [[], [], [], [], [], [], []];
  for (const [d, v] of intake) if (recent(d) && v.kcal >= 800) byDay[monFirst(d)].push(v.kcal);
  if (byDay.some((a) => a.length < 4)) return null;
  const kcal = byDay.map((a) => Math.round(median(a)));

  const resid: number[][] = [[], [], [], [], [], [], []];
  const valid = (weights ?? []).filter((w) => w?.date && w.weight > 0 && recent(w.date));
  for (const w of valid) {
    const t = Date.parse(`${w.date}T12:00:00`);
    const near = valid.filter((x) => Math.abs(Date.parse(`${x.date}T12:00:00`) - t) <= 10 * DAY_MS);
    if (near.length < 6) continue;
    const fit = fitWeightLine(near, t + 10 * DAY_MS, 21);
    if (!fit) continue;
    const lastT = Math.max(...near.map((x) => Date.parse(`${x.date}T12:00:00`)));
    resid[monFirst(w.date)].push(w.weight - (fit.endKg + fit.slopePerDay * ((t - lastT) / DAY_MS)));
  }
  const scale = resid.map((a) => (a.length >= 3 ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null));
  const known = scale.map((v, i) => [v, i] as const).filter(([v]) => v != null) as Array<readonly [number, number]>;
  const heaviest = known.length >= 5 ? known.reduce((a, b) => (b[0] > a[0] ? b : a))[1] : null;
  const lightest = known.length >= 5 ? known.reduce((a, b) => (b[0] < a[0] ? b : a))[1] : null;

  const weekendKcal = Math.round(median([4, 5, 6].flatMap((i) => byDay[i])) / 10) * 10;
  const weekdayKcal = Math.round(median([0, 1, 2, 3].flatMap((i) => byDay[i])) / 10) * 10;
  return { kcal, scale, weekdayKcal, weekendKcal, weekendGap: weekendKcal - weekdayKcal, heaviest, lightest };
}
