// Pure-math plate/warm-up calculators (Hevy/Strong-style). No dependencies,
// no network calls -- these are just arithmetic helpers used by the
// Workouts page.

export const DEFAULT_BAR_KG = 20;
// Standard Olympic plate set, heaviest first (greedy algorithm below
// assumes descending order).
export const DEFAULT_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

export interface PlateResult {
  perSide: number[]; // plates on ONE side, heaviest first
  achievedKg: number; // actual total achievable (may be < target if plates too coarse)
  exact: boolean;
}

/**
 * Greedy subtraction: how to load `targetKg` onto a barbell of `barKg`,
 * given an available set of plates (each plate available in unlimited
 * pairs). Returns the plates needed for ONE side.
 */
export function calculatePlates(
  targetKg: number,
  barKg: number = DEFAULT_BAR_KG,
  availablePlates: number[] = DEFAULT_PLATES_KG
): PlateResult {
  const perSideNeeded = Math.max(0, (targetKg - barKg) / 2);
  const plates = [...availablePlates].sort((a, b) => b - a);
  const perSide: number[] = [];
  let remaining = perSideNeeded;

  for (const plate of plates) {
    // Guard against floating point drift (e.g. 0.1+0.2 !== 0.3).
    while (remaining - plate >= -1e-9) {
      perSide.push(plate);
      remaining = Math.round((remaining - plate) * 1000) / 1000;
    }
  }

  const achievedKg = barKg + perSide.reduce((s, p) => s + p, 0) * 2;
  return { perSide, achievedKg, exact: Math.abs(achievedKg - targetKg) < 0.01 };
}

export interface WarmupSet {
  pct: number;
  weight: number;
  reps: number;
}

const WARMUP_SCHEME: Array<{ pct: number; reps: number }> = [
  { pct: 0.4, reps: 10 },
  { pct: 0.5, reps: 8 },
  { pct: 0.6, reps: 5 },
  { pct: 0.75, reps: 3 },
  { pct: 0.9, reps: 1 },
];

/**
 * Generates a warm-up ladder leading up to `workingWeightKg`, rounding
 * each step to the nearest achievable plate load (so every warm-up set
 * is something you can actually load on the bar, not a theoretical
 * number like "47.3kg").
 */
export function warmupLadder(
  workingWeightKg: number,
  barKg: number = DEFAULT_BAR_KG,
  availablePlates: number[] = DEFAULT_PLATES_KG,
  roundToKg: number = 2.5
): WarmupSet[] {
  return WARMUP_SCHEME.map(({ pct, reps }) => {
    const raw = workingWeightKg * pct;
    const rounded = Math.max(barKg, Math.round(raw / roundToKg) * roundToKg);
    return { pct: pct * 100, weight: rounded, reps };
  }).filter((s) => s.weight < workingWeightKg); // drop steps that'd round up to/past the work weight
}
