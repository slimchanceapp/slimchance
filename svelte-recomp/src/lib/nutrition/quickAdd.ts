// FOOD LOGGING, MADE CHEAP.
//
// Food logging is this app's dominant interaction by an order of magnitude — the
// one daily user logs 5-8 entries every single day, ~2,500 a year. Every one of
// them used to cost: open the form, type a name, wait on an OpenFoodFacts round
// trip (in a gym basement, maybe), then fill four macro fields. Seconds there
// compound into whether someone is still logging in week three.
//
// Almost none of that typing is necessary, because people eat the same things.
// This module derives three shortcuts from the food_logs the user ALREADY has:
//
//   frequentFoods()  — the handful you log constantly, one tap to log again
//   groupIntoMeals() — entries logged together become a re-loggable "meal"
//   repeatDay()      — everything you ate yesterday that you haven't logged today
//
// Deliberately NO saved-meals table. A meal is just the foods you logged within
// a few minutes of each other, so it can be derived — which means no migration,
// no RLS policy, no new row in the sync TABLES list, and nothing new that could
// leak between accounts (see the data-isolation audit).

import { cleanName, foodKey, historyFoods } from './food.ts';

/** A food_logs row, loosely typed — this module is pure and takes plain rows. */
export interface FoodRow {
  id?: string;
  name?: string | null;
  date?: string | null;
  kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  created_at?: string | null;
  grams?: number | null;
  source?: string | null;
  barcode?: string | null;
}

export interface QuickFood {
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Portion in grams when it was recorded. */
  grams?: number | null;
  /** How many times this name has ever been logged — drives the ranking. */
  count: number;
  /** Most recent date it was logged, so "recent" can beat "frequent" on ties. */
  lastDate: string;
}

const num = (n: unknown): number => {
  const x = typeof n === 'string' ? parseFloat(n) : n;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
};

/**
 * Foods ranked by how much you actually use them, carrying the macros from the
 * MOST RECENT time you logged each — so a portion you corrected last week is the
 * one that comes back, not the first guess you ever made.
 *
 * Ranking is count first, recency second. A food eaten 40 times but not for a
 * month still beats one eaten twice yesterday: the chips are for the staples.
 *
 * Grouping is by cleaned name (see food.ts): legacy rows carried their source in
 * the name — "Plain white rice (cooked) (AI estimate, high confidence)" — and
 * the old rule skipped anything named "(AI estimate". That kept this user's two
 * most-logged foods out of quick add entirely. A ONE-OFF AI
 * guess is still not a staple; a repeated one is.
 */
export function frequentFoods(logs: FoodRow[], limit = 8): QuickFood[] {
  return historyFoods(logs)
    .filter((c) => !(c.ai && (c.count ?? 1) < 2))
    .slice(0, Math.max(0, limit))
    .map((c) => ({
      name: c.name,
      kcal: c.portion?.kcal ?? 0, protein_g: c.portion?.protein_g ?? 0,
      carbs_g: c.portion?.carbs_g ?? 0, fat_g: c.portion?.fat_g ?? 0,
      grams: c.portion?.grams ?? null,
      count: c.count ?? 1, lastDate: c.lastDate ?? '',
    }));
}

/**
 * The fastest way to close today's protein gap, from food you actually eat:
 * things logged at least three times, ranked by protein per calorie, so the
 * top tap moves the protein number most for the least of the day's budget.
 * Deliberately NOT filtered on calories left — a target can be wrong, and
 * hiding the whey because of it helps no one.
 */
export function proteinFillers(logs: FoodRow[], limit = 3): QuickFood[] {
  return historyFoods(logs)
    .filter((c) => (c.count ?? 0) >= 3 && (c.portion?.protein_g ?? 0) >= 10 && (c.portion?.kcal ?? 0) > 0)
    .sort((a, b) => (b.portion!.protein_g / b.portion!.kcal) - (a.portion!.protein_g / a.portion!.kcal) || (b.count ?? 0) - (a.count ?? 0))
    .slice(0, limit)
    .map((c) => ({
      name: c.name,
      kcal: c.portion!.kcal, protein_g: c.portion!.protein_g,
      carbs_g: c.portion!.carbs_g ?? 0, fat_g: c.portion!.fat_g ?? 0,
      grams: c.portion!.grams ?? null,
      count: c.count ?? 1, lastDate: c.lastDate ?? '',
    }));
}

export interface Meal {
  /** Stable within a day — used as a keyed-each key and a "already added" marker. */
  key: string;
  /** "Breakfast", "Lunch", "Dinner", "Snack" — from the clock, not from a field. */
  label: string;
  /** ISO timestamp of the first item, or '' when the rows carry no created_at. */
  at: string;
  items: QuickFood[];
  kcal: number;
  protein_g: number;
}

/** Entries logged more than this far apart are separate meals, not one sitting. */
const MEAL_GAP_MS = 45 * 60 * 1000;

function mealLabel(hour: number): string {
  if (hour < 11) return 'Breakfast';
  if (hour < 15) return 'Lunch';
  if (hour < 21) return 'Dinner';
  return 'Snack';
}

/**
 * Cluster one day's entries into meals by when they were logged. Rows without a
 * created_at (hand-entered on a device with no clock context, or restored from
 * an old export) all collapse into a single unlabelled group rather than being
 * dropped — losing food from a re-log would be worse than an imprecise label.
 */
export function groupIntoMeals(logs: FoodRow[], dayYmd: string): Meal[] {
  const day = logs
    .filter((f) => f.date === dayYmd && f.name?.trim())
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  if (day.length === 0) return [];

  const clusters: FoodRow[][] = [];
  let current: FoodRow[] = [];
  let prevMs: number | null = null;

  for (const f of day) {
    const ms = f.created_at ? Date.parse(f.created_at) : NaN;
    const valid = Number.isFinite(ms);
    if (current.length > 0 && valid && prevMs != null && ms - prevMs > MEAL_GAP_MS) {
      clusters.push(current);
      current = [];
    }
    current.push(f);
    if (valid) prevMs = ms;
  }
  if (current.length > 0) clusters.push(current);

  return clusters.map((rows, i) => {
    const at = rows.find((r) => r.created_at)?.created_at || '';
    const hour = at ? new Date(at).getHours() : NaN;
    const items: QuickFood[] = rows.map((r) => ({
      name: cleanName(r.name || ''), grams: num(r.grams) || null,
      kcal: num(r.kcal), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g),
      count: 1, lastDate: r.date || dayYmd,
    }));
    return {
      key: `${dayYmd}#${i}`,
      label: Number.isFinite(hour) ? mealLabel(hour) : 'Meal',
      at,
      items,
      kcal: Math.round(items.reduce((s, x) => s + x.kcal, 0)),
      protein_g: Math.round(items.reduce((s, x) => s + x.protein_g, 0)),
    };
  });
}

/**
 * Of `items`, the ones not already logged on `date`, so a re-log is safe to tap
 * twice: the second tap adds nothing rather than silently doubling the day's
 * calories. Matching is by name: the same food logged twice in `items` and
 * once on `date` still has one serving left to add.
 */
export function notYetLogged(logs: FoodRow[], items: QuickFood[], date: string): QuickFood[] {
  const remaining = new Map<string, number>();
  for (const f of logs) {
    if (f.date !== date) continue;
    const n = f.name?.trim() ? foodKey(f.name) : '';
    if (n) remaining.set(n, (remaining.get(n) ?? 0) + 1);
  }
  return items.filter((it) => {
    const key = foodKey(it.name);
    const already = remaining.get(key) ?? 0;
    if (already > 0) { remaining.set(key, already - 1); return false; }
    return true;
  });
}

/** Everything eaten on `fromYmd` that has NOT already been logged on `toYmd`. */
export function repeatDay(logs: FoodRow[], fromYmd: string, toYmd: string): QuickFood[] {
  const from = logs
    .filter((x) => x.date === fromYmd && x.name?.trim())
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    .map((f) => ({
      name: cleanName(f.name!), kcal: num(f.kcal), protein_g: num(f.protein_g), carbs_g: num(f.carbs_g),
      fat_g: num(f.fat_g), grams: num(f.grams) || null, count: 1, lastDate: f.date || fromYmd,
    }));
  return notYetLogged(logs, from, toYmd);
}

/**
 * The breakfast you eat most mornings, if there is one: the same foods (by
 * name) as the day's first meal before 11:00 on at least `minDays` of the
 * `days` days before `date`, with the portions from the latest of them. Null
 * when breakfast varies: a one-tap "log the usual" is only honest when there
 * is a usual.
 */
export function usualBreakfast(logs: FoodRow[], date: string, days = 14, minDays = 5): Meal | null {
  const seen = new Map<string, { count: number; latest: Meal }>();
  const at = new Date(`${date}T12:00:00`);
  for (let i = 1; i <= days; i++) {
    const d = new Date(at);
    d.setDate(d.getDate() - i);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const first = groupIntoMeals(logs, ymd)[0];
    if (!first || first.label !== 'Breakfast') continue;
    const key = [...new Set(first.items.map((x) => foodKey(x.name)))].sort().join('|');
    const had = seen.get(key);
    // Days run newest first, so the first one met is the latest portion.
    seen.set(key, { count: (had?.count ?? 0) + 1, latest: had?.latest ?? first });
  }
  let best: { count: number; latest: Meal } | null = null;
  for (const v of seen.values()) if (!best || v.count > best.count) best = v;
  return best && best.count >= minDays ? best.latest : null;
}

const SLOT_ORDER = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

/**
 * Every usual meal, not just breakfast (2026-11-11, food friction): for each
 * slot of the day, the same foods (by name) on at least `minDays` of the `days`
 * days before `date`, with the portions from the latest of them. A slot that
 * varies has no usual, as with usualBreakfast: one tap is only honest when
 * there is a usual. In the order of the day.
 */
export function usualMeals(logs: FoodRow[], date: string, days = 14, minDays = 5): Meal[] {
  const seen = new Map<string, { label: string; count: number; latest: Meal }>();
  const at = new Date(`${date}T12:00:00`);
  for (let i = 1; i <= days; i++) {
    const d = new Date(at);
    d.setDate(d.getDate() - i);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const counted = new Set<string>();
    for (const m of groupIntoMeals(logs, ymd)) {
      const key = `${m.label}#${[...new Set(m.items.map((x) => foodKey(x.name)))].sort().join('|')}`;
      if (counted.has(key)) continue;
      counted.add(key);
      const had = seen.get(key);
      // Days run newest first, so the first one met is the latest portion.
      seen.set(key, { label: m.label, count: (had?.count ?? 0) + 1, latest: had?.latest ?? m });
    }
  }
  const best = new Map<string, { count: number; latest: Meal }>();
  for (const v of seen.values()) {
    const b = best.get(v.label);
    if (v.count >= minDays && (!b || v.count > b.count)) best.set(v.label, v);
  }
  return [...best.entries()].sort((a, b) => SLOT_ORDER.indexOf(a[0]) - SLOT_ORDER.indexOf(b[0])).map(([, v]) => v.latest);
}
