// The one way a weigh-in is saved. Today's morning card and Body & Goals both
// come here, so a reading gets the same row, the same Health Connect copy and
// the same few words back wherever it was typed. (They used to be two paths;
// only one of them wrote back to Health Connect or noticed a new low.)
import db from '$lib/db/dexie';
import { upsertRecord } from '$lib/stores/sync';
import { speak } from '$lib/stores/toast';
import { haptic } from '$lib/haptics';
import { writeBackToHealth } from '$lib/health/writeBack';
import { weighInMessage, offTrend } from './scale';
import { dwt, wt } from '$lib/units';

/** The reading is far off the trend: show the message, and save on a second
 *  tap with `confirmed`. */
export class NeedsConfirm extends Error {}

export async function saveWeighIn(uid: string, kg: number, ctx: {
  today: string; weights: Array<{ date: string; weight: number }>; goalKg: number | null; startKg: number | null;
  trendKg: number | null; confirmed?: boolean;
}): Promise<void> {
  if (!uid) throw new Error('Not signed in — sign back in.');
  if (!(kg > 0)) throw new Error('That isn’t a weight.');
  const off = offTrend(kg, ctx.trendKg);
  if (off != null && !ctx.confirmed) {
    throw new NeedsConfirm(`${wt(kg)} is ${dwt(off)} ${off > 0 ? 'above' : 'below'} your trend. A typo? If it's right, tap again to save it.`);
  }
  const existing = await db.table('weights').where('[user_id+date]').equals([uid, ctx.today]).first();
  await upsertRecord('weights', {
    id: existing?.id || undefined,
    user_id: uid, date: ctx.today, weight: kg,
    created_at: new Date().toISOString(),
    // A reading typed here is the person's own: it replaces an imported one
    // for that day, and undoing the import must never take it away.
    source: null,
  });
  haptic('success');
  // Fire-and-forget: a Health Connect write must never be able to fail the
  // weigh-in itself.
  writeBackToHealth([], [{ time: new Date(), kg }]).catch(() => {});
  const said = weighInMessage(kg, ctx);
  if (said) speak(said.key, said.title, { tone: 'good', icon: said.icon, ttl: said.ttl, body: said.body });
}
