// The way to the goal on Progress (the owner, 2026-11-03, after Happy Scale's
// milestone scale). A path from the first weigh-in to the goal with a stop at
// every tenth of the way. It was ten coins until 2026-11-10; coins now mean
// the chance and nothing else (the coin rule), so distance is a path. The
// healthy-weight line (BMI 25) sits on the same path as a place, never as a
// category word: a label like "obese" is the shame this app is built against.

export interface TrackStop { kg: number; passed: boolean; next: boolean }
export interface SlimTrack {
  stops: TrackStop[];
  passed: number;
  /** How far along, 0 (start) to 1 (goal). */
  at: number;
  /** BMI now, to one decimal; null without a height. */
  bmi: number | null;
  /** Where BMI 25 falls on the path, 0 (start) to 1 (goal); null off it. */
  healthyAt: number | null;
  healthyKg: number | null;
}

export function slimTrack(i: { startKg: number | null; goalKg: number | null; currentKg: number | null; heightCm: number | null }): SlimTrack | null {
  const { startKg: a, goalKg: g, currentKg: c } = i;
  if (a == null || g == null || c == null || Math.abs(a - g) < 0.5) return null;
  const down = g < a;
  const stops: TrackStop[] = [];
  for (let k = 1; k <= 10; k++) {
    const kg = Math.round((a + ((g - a) * k) / 10) * 10) / 10;
    stops.push({ kg, passed: down ? c <= kg : c >= kg, next: false });
  }
  const n = stops.findIndex((x) => !x.passed);
  if (n >= 0) stops[n].next = true;
  const m = i.heightCm && i.heightCm > 100 ? i.heightCm / 100 : null;
  const healthyKg = m ? Math.round(25 * m * m * 10) / 10 : null;
  const healthy = healthyKg != null ? (a - healthyKg) / (a - g) : null;
  return {
    stops, passed: stops.filter((x) => x.passed).length,
    at: Math.round(Math.min(1, Math.max(0, (a - c) / (a - g))) * 1000) / 1000,
    bmi: m ? Math.round((c / (m * m)) * 10) / 10 : null,
    healthyAt: healthy != null && healthy > 0 && healthy < 1 ? Math.round(healthy * 1000) / 1000 : null,
    healthyKg,
  };
}
