// A small celebration on Today, earned by what was done (the owner,
// 2026-11-03: "more love and more power to you"). Protein hit; and in the
// evening, a day inside the budget that was also fed enough. A day under the
// floor is never celebrated: that would reward eating too little. Each is
// shown once a day (the caller keeps `seen`).

export interface Cheer { id: string; text: string }

export function cheerFor(i: {
  today: string; hour: number; seen: Set<string>;
  proteinG: number | null; proteinTargetG: number | null;
  kcal: number | null; dayKcal: number | null; floorKcal: number | null;
}): Cheer | null {
  const protein = `protein:${i.today}`;
  if (i.proteinG != null && i.proteinTargetG && i.proteinG >= i.proteinTargetG && !i.seen.has(protein)) {
    return { id: protein, text: `Protein hit: ${Math.round(i.proteinG)} g. That’s what keeps the muscle while the fat goes. More power to you.` };
  }
  const day = `day:${i.today}`;
  if (i.hour >= 19 && i.kcal != null && i.dayKcal && i.floorKcal != null && i.kcal >= i.floorKcal && i.kcal <= i.dayKcal && !i.seen.has(day)) {
    return { id: day, text: 'Inside your budget today, and fed enough. That’s the whole game, one day at a time.' };
  }
  return null;
}
