// The coach's latest plan, kept on this device: Food makes it, Today follows
// it (2026-10-31). A new plan replaces the old one; past days simply stop
// showing.
import { writable } from 'svelte/store';
import type { CheckedPlan } from '$lib/nutrition';

const KEY = 'recompos.coachPlan';

function load(): CheckedPlan | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

export const coachPlan = writable<CheckedPlan | null>(load());
coachPlan.subscribe((p) => {
  try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* storage off: it lasts this visit */ }
});
