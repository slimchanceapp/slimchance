// The one way food is saved. The Food page (search, scan, photo, AI, quick add,
// re-logging) and the morning briefing's "log usual breakfast" button both come
// here, so a meal is the same rows wherever it was logged.
import { upsertRecords } from '$lib/stores/sync';
import type { NewFood } from './food';

/** One request for the whole meal: all of it is saved or none, so a failure
 *  can be retried without doubling the items that had gone through. */
export async function saveFoods(uid: string, date: string, foods: NewFood[], at = new Date().toISOString()): Promise<void> {
  if (!uid) throw new Error('Not signed in — sign back in.');
  if (!foods.length) return;
  await upsertRecords('food_logs', foods.map((f) => ({
    id: crypto.randomUUID(), user_id: uid, date, name: f.name,
    kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g,
    grams: f.grams ?? null, barcode: f.barcode ?? null, source: f.source,
    created_at: at,
  })));
}
