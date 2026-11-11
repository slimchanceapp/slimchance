// NEXT STOP — the near goal on the way to the far one.
//
// A goal 17 kg away is a year off and too far to steer by on a Friday night; a
// stop 8 kg away is a season. Near goals are the ones people act on: proximal
// subgoals raise effort and self-efficacy more than a distant goal alone
// (Bandura & Schunk 1981). And a stop can mean something by itself — where the
// "obese" BMI band ends for this height — which the app can say, because it
// knows the height.
//
// Below you, unlike the ceiling (line.ts), which sits above you. Pure; see
// selfcheck.js.
import { floorIn, roundStep, wt } from '../units.ts';

/** A stop that was reached, kept so the journal can tell the story. */
export interface ReachedStop { kg: number; set: string; reached: string }

export interface MilestoneSetting {
  /** The current stop; null between stops (only the history is kept). */
  kg: number | null;
  set: string;
  /** The day the user marked this stop as reached. */
  reached?: string | null;
  history?: ReachedStop[];
}

export interface MilestoneState {
  kg: number;
  /** Trend minus the stop, kg; null without a trend. */
  toGoKg: number | null;
  reached: boolean;
  /** The trend has stayed at or under the stop for HELD_DAYS days: the moment. */
  held: boolean;
  /** The user has marked it reached; the moment was had. */
  celebrated: boolean;
  /** The trend on the day the stop was set; null when unknown. */
  fromKg: number | null;
  /** The BMI band the trend has left since the stop was set ("obese"), only
   *  once it has really crossed: 95.1 is still "obese" at 178 cm. */
  crossed: string | null;
  /** BMI at the stop, for this height. */
  bmi: number | null;
  /** What the stop means, when it means something. */
  meaning: string | null;
}

/** A stop counts as reached when the trend has stayed at or under it this
 *  many days running: one lucky morning isn't the moment, staying there is. */
export const HELD_DAYS = 3;

const ymdMinus = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function heldUnder(kg: number, trendOn: (ymd: string) => number | null, today: string, days = HELD_DAYS): boolean {
  for (let i = 0; i < days; i++) {
    const t = trendOn(ymdMinus(today, i));
    if (t == null || t > kg) return false;
  }
  return true;
}

/** The setting after choosing the next stop (null: none for now). The stop
 *  just left joins the history if it was reached; nothing else is lost. */
export function nextMilestone(prev: MilestoneSetting | null | undefined, kg: number | null, today: string): MilestoneSetting | null {
  const history = [...(prev?.history ?? [])];
  if (prev?.kg && prev.reached) history.push({ kg: prev.kg, set: prev.set, reached: prev.reached });
  const stop = kg != null && kg > 0 ? Math.round(kg * 10) / 10 : null;
  if (stop == null && !history.length) return null;
  return { kg: stop, set: today, ...(history.length ? { history } : {}) };
}

const BANDS: Array<{ bmi: number; name: string }> = [
  { bmi: 30, name: 'obese' },
  { bmi: 25, name: 'overweight' },
];

/** The named BMI band a weight is in at this height, or null below them. */
export function bandOf(kg: number, heightCm: number): string | null {
  return BANDS.find((b) => kg > weightUnderBmi(b.bmi, heightCm))?.name ?? null;
}

export function bmiAt(kg: number, heightCm: number): number {
  return kg / (heightCm / 100) ** 2;
}

/** The heaviest weight, to 0.1 kg, still under a BMI line at this height. */
export function weightUnderBmi(bmi: number, heightCm: number): number {
  return Math.ceil(bmi * (heightCm / 100) ** 2 * 10 - 1) / 10;
}

export function milestoneState(
  s: MilestoneSetting | null | undefined, trendKg: number | null, heightCm: number | null,
  ctx?: { today: string; trendOn: (ymd: string) => number | null },
): MilestoneState | null {
  if (!s || !s.kg || !(s.kg > 0)) return null;
  const stop = s.kg;
  const toGoKg = trendKg != null ? Math.round((trendKg - stop) * 10) / 10 : null;
  let meaning: string | null = null;
  if (heightCm && heightCm > 0) {
    for (const b of BANDS) {
      const under = weightUnderBmi(b.bmi, heightCm);
      if (stop <= under && (trendKg == null || trendKg > under)) { meaning = `out of the “${b.name}” BMI range`; break; }
      if (stop > under && stop - under <= 1) { meaning = `the “${b.name}” BMI range ends at ${wt(under)}`; break; }
    }
  }
  // The trend when the stop was set, or the first day after with one (a stop
  // set in the first days of weighing has no trend yet on its own day).
  let fromKg: number | null = null;
  for (let i = 0; ctx && i <= 14 && fromKg == null; i++) fromKg = ctx.trendOn(ymdMinus(s.set, -i));
  const left = heightCm && fromKg != null && trendKg != null ? bandOf(fromKg, heightCm) : null;
  const crossed = left && heightCm && trendKg != null && bandOf(trendKg, heightCm) !== left ? left : null;
  return {
    kg: stop, toGoKg, reached: toGoKg != null && toGoKg <= 0,
    held: ctx ? heldUnder(stop, ctx.trendOn, ctx.today) : false,
    celebrated: !!s.reached,
    fromKg: fromKg != null ? Math.round(fromKg * 10) / 10 : null,
    crossed,
    bmi: heightCm ? Math.round(bmiAt(stop, heightCm) * 10) / 10 : null,
    meaning,
  };
}

/** Stops worth offering from here: the next round five, the BMI lines still
 *  ahead, and the goal itself. */
export function suggestStops(trendKg: number, heightCm: number | null, goalKg: number | null): number[] {
  const out = new Set<number>();
  // A round number in the person's own unit: 95 kg, 210 lb, 15 st.
  const five = floorIn(trendKg - 0.5, roundStep());
  if (five > 0 && five < trendKg) out.add(five);
  if (heightCm) for (const b of BANDS) { const u = weightUnderBmi(b.bmi, heightCm); if (u < trendKg) out.add(u); }
  if (goalKg && goalKg < trendKg) {
    // The user's own number beats one within a kilo of it.
    for (const v of [...out]) if (Math.abs(v - goalKg) < 1) out.delete(v);
    out.add(goalKg);
  }
  return [...out].sort((a, b) => b - a).slice(0, 4);
}
