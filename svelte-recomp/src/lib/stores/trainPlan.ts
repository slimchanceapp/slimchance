// The coach's latest training week, kept on this device like the meal plan
// (stores/coachPlan.ts): a new one replaces it; past days stop showing.
import { writable } from 'svelte/store';
import type { CheckedTrainPlan } from '$lib/trainPlan';

const KEY = 'recompos.trainPlan';

function load(): CheckedTrainPlan | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

export const trainPlan = writable<CheckedTrainPlan | null>(load());
trainPlan.subscribe((p) => {
  try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* storage off: it lasts this visit */ }
});
