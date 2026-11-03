// The Slim Chance track (the owner, 2026-11-03, after seeing Happy Scale's
// milestone scale: "use slim and chance ... to show what chance we have at
// being slim"). Ten coins from the first weigh-in to the goal, one for each
// tenth of the way: the ones passed have landed, the next one is in play. The
// healthy-weight line (BMI 25) sits on the same track as a place, never as a
// category word: a label like "obese" is the shame this app is built against.

export interface TrackCoin { kg: number; landed: boolean; next: boolean }
export interface SlimTrack {
  coins: TrackCoin[];
  landed: number;
  /** BMI now, to one decimal; null without a height. */
  bmi: number | null;
  /** Where BMI 25 falls on the track, 0 (start) to 1 (goal); null off it. */
  healthyAt: number | null;
  healthyKg: number | null;
}

export function slimTrack(i: { startKg: number | null; goalKg: number | null; currentKg: number | null; heightCm: number | null }): SlimTrack | null {
  const { startKg: a, goalKg: g, currentKg: c } = i;
  if (a == null || g == null || c == null || Math.abs(a - g) < 0.5) return null;
  const down = g < a;
  const coins: TrackCoin[] = [];
  for (let k = 1; k <= 10; k++) {
    const kg = Math.round((a + ((g - a) * k) / 10) * 10) / 10;
    coins.push({ kg, landed: down ? c <= kg : c >= kg, next: false });
  }
  const n = coins.findIndex((x) => !x.landed);
  if (n >= 0) coins[n].next = true;
  const m = i.heightCm && i.heightCm > 100 ? i.heightCm / 100 : null;
  const healthyKg = m ? Math.round(25 * m * m * 10) / 10 : null;
  const at = healthyKg != null ? (a - healthyKg) / (a - g) : null;
  return {
    coins, landed: coins.filter((x) => x.landed).length,
    bmi: m ? Math.round((c / (m * m)) * 10) / 10 : null,
    healthyAt: at != null && at > 0 && at < 1 ? Math.round(at * 1000) / 1000 : null,
    healthyKg,
  };
}
