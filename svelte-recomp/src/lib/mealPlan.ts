// The coach's plan for the next days of the week (2026-10-31, the owner: "I
// want this eating order to come from my AI coach"). The AI only picks foods
// from the table the app hands it, with grams. Every calorie and gram of
// protein is the app's own arithmetic from that table, and a plan that goes
// under the floor, over the day, short of protein, or names a food that
// isn't in the table is refused. Pure; see selfcheck.js.
import { BASE_FOODS } from './data/foods.ts';
import type { NewFood } from './food.ts';

/** Per 100 g (100 ml for drinks). */
export interface PlanFood { name: string; kcal: number; protein: number }

/** The staples any plan may use: lean protein first, then what makes a day
 *  livable. All in the app's own food table, all at a Slovak supermarket. */
export const PLAN_STAPLES = [
  'Chicken breast, raw', 'Tuna in water, drained', 'Egg', 'Egg white', 'Quark, fat-free (tvaroh)', 'Skyr',
  'Cottage cheese', 'Whey protein powder', 'Ham, cooked (šunka)', 'Salmon, cooked', 'Yogurt, plain 3%', 'Kefir',
  'Potatoes, boiled', 'Rice, white, cooked', 'Bread, wholegrain', 'Oats, rolled (dry)', 'Broccoli', 'Cucumber',
  'Bell pepper', 'Tomato', 'Apple', 'Banana', 'Olive oil',
] as const;

/** The table: the staples, then the person's own usual foods (from their log,
 *  per 100 g), forty rows at most. */
export function planFoods(usual: PlanFood[] = []): PlanFood[] {
  const out: PlanFood[] = [];
  const seen = new Set<string>();
  const add = (f: PlanFood) => {
    const k = f.name.trim().toLowerCase();
    if (!k || seen.has(k) || !(f.kcal >= 0) || !(f.protein >= 0)) return;
    seen.add(k);
    out.push({ name: f.name.trim(), kcal: Math.round(f.kcal), protein: Math.round(f.protein * 10) / 10 });
  };
  for (const n of PLAN_STAPLES) {
    const b = BASE_FOODS.find((f) => f.name === n);
    if (b) add({ name: b.name, kcal: b.kcal, protein: b.protein_g });
  }
  for (const f of usual) add(f);
  return out.slice(0, 40);
}

/** The person's usual foods from the last four weeks of their log, per 100 g,
 *  most logged first. Only entries with grams can be scaled. */
export function usualFoods(logs: Array<{ date: string; name?: string | null; grams?: number | null; kcal?: number | null; protein_g?: number | null }>, since: string, n = 12): PlanFood[] {
  const by = new Map<string, { name: string; count: number; kcal: number; protein: number }>();
  for (const l of logs) {
    const g = Number(l.grams);
    if (l.date < since || !l.name || !(g > 0) || l.kcal == null) continue;
    const k = l.name.trim().toLowerCase();
    const e = by.get(k) ?? { name: l.name.trim(), count: 0, kcal: 0, protein: 0 };
    e.count++;
    e.kcal += (Number(l.kcal) / g) * 100;
    e.protein += (Number(l.protein_g ?? 0) / g) * 100;
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, n)
    .map((e) => ({ name: e.name, kcal: e.kcal / e.count, protein: e.protein / e.count }));
}

/** What each planned day aims at: the week's share of what's left, never more
 *  than the usual target (budget left is room, not something to eat up) and
 *  never under the floor (no hard day to "pay back" an earlier one). */
export function planDayKcal(i: { share: number; dayTarget: number; floorKcal: number }): number {
  return Math.round(Math.max(i.floorKcal, Math.min(i.share, i.dayTarget)));
}

export interface PlanReply {
  days: Array<{ date: string; meals: Array<{ time: string; items: Array<{ food: string; grams: number }> }> }>;
  note?: string;
}

export interface PlanItem { food: string; grams: number; kcal: number; protein: number }
export interface PlanMeal { time: string; kcal: number; protein: number; items: PlanItem[] }
export interface PlanDay { date: string; kcal: number; protein: number; meals: PlanMeal[] }
export interface CheckedPlan { ok: boolean; why: string | null; days: PlanDay[]; note: string }

/** A planned meal as food rows at the planned grams, for one-tap "Eaten"
 *  (the owner, 2026-11-03): kcal and protein as the plan worked them out;
 *  carbs and fat per 100 g from the same food in the person's own log, else
 *  the built-in table, else 0. Logged under the plan's own names, so the meal
 *  ticks itself off. */
export function mealAsFoods(meal: PlanMeal, logs: Array<{ name?: string | null; grams?: number | string | null; carbs_g?: number | string | null; fat_g?: number | string | null }>): NewFood[] {
  const per100 = (name: string) => {
    const k = name.trim().toLowerCase();
    const row = logs.find((l) => l.name?.trim().toLowerCase() === k && Number(l.grams) > 0);
    if (row) return { c: ((Number(row.carbs_g) || 0) / Number(row.grams)) * 100, f: ((Number(row.fat_g) || 0) / Number(row.grams)) * 100 };
    const b = BASE_FOODS.find((x) => x.name.toLowerCase() === k);
    return b ? { c: b.carbs_g, f: b.fat_g } : { c: 0, f: 0 };
  };
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return meal.items.map((x) => {
    const m = per100(x.food);
    return { name: x.food, grams: x.grams, kcal: x.kcal, protein_g: x.protein, carbs_g: r1((m.c * x.grams) / 100), fat_g: r1((m.f * x.grams) / 100), source: 'plan' };
  });
}

/** Today's meals from the coach's plan, each ticked once all its foods are in
 *  today's log (by name, as the plan was made from the log's own names). */
export function todaysMeals(plan: CheckedPlan | null, today: string, logged: string[]): Array<PlanMeal & { done: boolean }> | null {
  const day = plan?.days.find((d) => d.date === today);
  if (!day) return null;
  const have = new Set(logged.map((n) => n.trim().toLowerCase()));
  return day.meals.map((m) => ({ ...m, done: m.items.every((x) => have.has(x.food.toLowerCase())) }));
}

/** Recompute the AI's plan from the table and accept it only inside the rules. */
export function checkPlan(reply: PlanReply | null | undefined, f: { days: string[]; dayKcal: number; floorKcal: number; proteinTargetG: number; foods: PlanFood[] }): CheckedPlan {
  const fail = (why: string): CheckedPlan => ({ ok: false, why, days: [], note: '' });
  if (!reply || !Array.isArray(reply.days)) return fail('no plan in the answer');
  const table = new Map(f.foods.map((x) => [x.name.toLowerCase(), x]));
  const days: PlanDay[] = [];
  for (const date of f.days) {
    const d = reply.days.find((x) => x?.date === date);
    if (!d || !Array.isArray(d.meals)) return fail(`no meals for ${date}`);
    const meals: PlanMeal[] = [];
    for (const m of d.meals) {
      const items: PlanItem[] = [];
      for (const it of Array.isArray(m?.items) ? m.items : []) {
        const food = table.get(String(it?.food ?? '').trim().toLowerCase());
        const g = Math.round(Number(it?.grams));
        if (!food) return fail(`"${String(it?.food ?? '')}" isn't in the food table`);
        if (!(g >= 5 && g <= 1000)) return fail(`${g} g of ${food.name}`);
        items.push({ food: food.name, grams: g, kcal: Math.round((food.kcal * g) / 100), protein: Math.round(food.protein * g) / 100 });
      }
      if (items.length) {
        meals.push({ time: String(m.time ?? '').slice(0, 5), kcal: items.reduce((s, x) => s + x.kcal, 0),
          protein: Math.round(items.reduce((s, x) => s + x.protein, 0)), items });
      }
    }
    const kcal = meals.reduce((s, m) => s + m.kcal, 0);
    const protein = Math.round(meals.reduce((s, m) => s + m.items.reduce((t, x) => t + x.protein, 0), 0));
    if (!meals.length) return fail(`no meals for ${date}`);
    if (kcal < f.floorKcal - 50) return fail(`${date} comes to ${kcal} kcal, under the floor of ${f.floorKcal}`);
    if (kcal > f.dayKcal + 150) return fail(`${date} comes to ${kcal} kcal, over the day's ${f.dayKcal}`);
    if (protein < f.proteinTargetG * 0.9) return fail(`${date} has ${protein} g protein, short of ${f.proteinTargetG}`);
    days.push({ date, kcal, protein, meals });
  }
  // The words are the AI's; every number on screen is the app's.
  const note = String(reply.note ?? '').trim();
  return { ok: true, why: null, days, note: /\d/.test(note) ? '' : note.slice(0, 300) };
}
