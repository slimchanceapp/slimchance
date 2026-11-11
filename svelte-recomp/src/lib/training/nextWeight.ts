// Gym-real weight progression.
//
// The progressive-overload prompt used to say "try 18.5kg next time" — a number
// you cannot actually pick up. Fixed dumbbells jump 17.5 → 20; a barbell only
// changes in whole plate PAIRS (the smallest common plate is 1.25kg a side, so
// the bar moves in 2.5kg steps). This module snaps any raw target to the nearest
// load that actually exists on a commercial gym floor, so every suggestion is
// something you can walk over and lift — never "18 after 17.5".
//
// Pure + framework-free, so it's unit-tested in selfcheck.js.

export type Equipment = 'dumbbell' | 'barbell' | 'machine' | 'cable' | 'bodyweight';

const EPS = 1e-6;

/**
 * The standard commercial fixed-dumbbell rack. Below 10kg most gyms rack whole
 * and half steps; from 10kg up the near-universal jump is 2.5kg (…15, 17.5, 20,
 * 22.5…). This is why "the next number from 17.5 is 20" — there is no 18.75 on
 * the rack.
 */
export const DUMBBELL_LADDER_KG: number[] = [
  1, 2, 3, 4, 5, 6, 7.5, 10,
  12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5,
  40, 42.5, 45, 47.5, 50, 55, 60,
];

/** Smallest achievable jump for plate-loaded / pin-stack kit, in kg. */
const INCREMENT_KG: Record<Exclude<Equipment, 'dumbbell' | 'bodyweight'>, number> = {
  // A barbell changes in plate PAIRS: the smallest common plate is 1.25kg per
  // side = 2.5kg total. So the bar only ever lands on a 2.5kg grid.
  barbell: 2.5,
  // Pin stacks are usually 5kg, but most have a 2.5kg add-on magnet/half-block,
  // so 2.5 is the smallest realistically-available bump.
  machine: 2.5,
  cable: 2.5,
};

/**
 * Guess the equipment from the exercise name — no equipment field is stored, so
 * we read it the way a human does. Order matters: "dumbbell" and "barbell" are
 * explicit; machine/cable are keyworded; everything else defaults to barbell
 * (the safest 2.5kg grid) unless it's clearly bodyweight.
 */
export function inferEquipment(name: string): Equipment {
  const n = (name || '').toLowerCase();
  if (/\b(db|dumbbell|dumbell|kettlebell|kb)\b|dumbbell|kettlebell/.test(n)) return 'dumbbell';
  if (/cable|pushdown|press.?down|pull.?down|lat pulldown|rope|face pull/.test(n)) return 'cable';
  if (/machine|smith|leg press|leg extension|leg curl|pec deck|hack squat|chest press machine|seated row|assisted/.test(n)) return 'machine';
  if (/barbell|bar\b|deadlift|squat|bench press|overhead press|ohp|romanian|rdl|hip thrust|row/.test(n)) return 'barbell';
  if (/plank|push.?up|pull.?up|chin.?up|dip|sit.?up|crunch|mountain climber|burpee|bodyweight|hollow|superman|stretch|mobility/.test(n)) return 'bodyweight';
  return 'barbell';
}

/**
 * The next real load STRICTLY above `currentKg` for a given equipment type.
 * Dumbbells step to the next rung on the rack; everything else advances by the
 * smallest achievable plate/pin increment. Returns null for bodyweight (there's
 * no weight to add — progress there is reps, not kilos).
 */
export function nextGymWeight(currentKg: number, equipment: Equipment): number | null {
  if (equipment === 'bodyweight') return null;
  if (!(currentKg > 0)) currentKg = 0;

  if (equipment === 'dumbbell') {
    for (const w of DUMBBELL_LADDER_KG) {
      if (w > currentKg + EPS) return w;
    }
    // Above the rack: keep climbing on the rack's top step (2.5kg).
    const top = DUMBBELL_LADDER_KG[DUMBBELL_LADDER_KG.length - 1];
    return roundTo(currentKg + 2.5, 2.5, top);
  }

  const inc = INCREMENT_KG[equipment];
  // Advance to the next multiple of `inc` strictly greater than current.
  const steps = Math.floor((currentKg + EPS) / inc) + 1;
  return roundTo(steps * inc, inc);
}

/**
 * Snap a raw weight to the nearest load you can actually load/select (used for
 * deloads, where "90% of 42.5 = 38.25kg" must become a real 37.5kg dumbbell or
 * a 37.5kg bar). Rounds to nearest, not up.
 */
export function roundToGymWeight(rawKg: number, equipment: Equipment): number | null {
  if (equipment === 'bodyweight') return null;
  if (!(rawKg > 0)) return 0;

  if (equipment === 'dumbbell') {
    let best = DUMBBELL_LADDER_KG[0];
    let bestDiff = Math.abs(rawKg - best);
    for (const w of DUMBBELL_LADDER_KG) {
      const d = Math.abs(rawKg - w);
      if (d < bestDiff - EPS) { best = w; bestDiff = d; }
    }
    return best;
  }

  const inc = INCREMENT_KG[equipment];
  return roundTo(Math.round(rawKg / inc) * inc, inc);
}

/** Round to a clean multiple of `inc`, optionally clamped to a minimum. */
function roundTo(v: number, inc: number, min = 0): number {
  const snapped = Math.round(v / inc) * inc;
  const clamped = Math.max(min, snapped);
  // Kill float drift so 17.5 stays 17.5, not 17.500000000000004.
  return Math.round(clamped * 1000) / 1000;
}
