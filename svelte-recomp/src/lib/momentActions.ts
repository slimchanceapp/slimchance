// Saving what was entered on the morning briefing's buttons: a weight, a back
// rating, the usual breakfast. Android holds each one until it has been saved
// here, through the same paths the app's own screens use (saveWeighIn with its
// typo guard, saveFoods, the Back Rebuild rating), and only then lets go of it.
import { get, writable } from 'svelte/store';
import { momentsAck, momentsPending, type MomentInput } from '$lib/nativeAlarms';
import { NeedsConfirm, saveWeighIn } from '$lib/body/weighIn';
import { saveFoods } from '$lib/nutrition/foodLog';
import { upsertRecord } from '$lib/stores/sync';
import { notYetLogged } from '$lib/nutrition';
import { parseWt } from '$lib/units';

/** What was typed on the notification is in the person's own unit (the
 *  briefing's weighRange is too): pounds, or for stone users the pounds they
 *  typed. Kilograms pass through unchanged. */
export const nativeKg = (it: { kg: number }): number => parseWt(String(it.kg)) ?? it.kg;

type WeightInput = Extract<MomentInput, { type: 'weight' }>;

/** A weight from the notification that's far off the trend. The app asks
 *  before saving it, as the Today card does; until then it stays queued. */
export const confirmWeight = writable<WeightInput | null>(null);

export interface MomentContext {
  uid: string;
  weights: Array<{ date: string; weight: number }>;
  goalKg: number | null;
  startKg: number | null;
  trendKg: number | null;
  /** food_logs rows, so the usual breakfast is never logged twice. */
  food: any[];
}

let running = false;

export async function saveMomentInputs(ctx: MomentContext): Promise<void> {
  if (running || !ctx.uid) return;
  running = true;
  try {
    const done: string[] = [];
    for (const it of await momentsPending()) {
      try {
        if (it.type === 'weight') {
          if (get(confirmWeight)?.id === it.id) continue; // already asking
          // Sent twice from the notification when far from the trend: answered.
          await saveWeighIn(ctx.uid, nativeKg(it), { ...weighCtx(ctx), today: it.date, confirmed: !!it.confirmed });
        } else if (it.type === 'back') {
          await upsertRecord('daily_logs', { user_id: ctx.uid, date: it.date, back_pain: it.value });
        } else if (it.type === 'meal') {
          // Anything already logged that day (in the app, or by a second
          // press) isn't logged again.
          const left = notYetLogged(ctx.food, it.items.map((x) => ({ ...x, count: 1, lastDate: it.date })), it.date);
          await saveFoods(ctx.uid, it.date, left.map((x) => ({
            name: x.name, kcal: x.kcal, protein_g: x.protein_g, carbs_g: x.carbs_g, fat_g: x.fat_g, grams: x.grams ?? null, source: 'quick',
          })), it.at);
        }
        done.push(it.id);
      } catch (e) {
        if (e instanceof NeedsConfirm && it.type === 'weight') confirmWeight.set(it);
        // Anything else stays queued: the next open tries again.
        else console.warn('[moments] could not save', it.type, e);
      }
    }
    await momentsAck(done);
  } finally {
    running = false;
  }
}

/** The answer to confirmWeight: save it after all, or let it go. */
export async function answerWeight(ctx: MomentContext, save: boolean): Promise<void> {
  const it = get(confirmWeight);
  if (!it) return;
  if (save) await saveWeighIn(ctx.uid, nativeKg(it), { ...weighCtx(ctx), today: it.date, confirmed: true });
  await momentsAck([it.id]);
  confirmWeight.set(null);
}

const weighCtx = (ctx: MomentContext) => ({ weights: ctx.weights, goalKg: ctx.goalKg, startKg: ctx.startKg, trendKg: ctx.trendKg });
