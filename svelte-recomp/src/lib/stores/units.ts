// The shell side of units.ts: the device remembers the person's unit, so the
// first frame after a reload is already in pounds or stone for them. Kept out
// of units.ts so the core it feeds stays pure (2026-11-10).
import { setUnits, restoreUnit, weightUnit, UNIT_MEMORY_KEY } from '$lib/units';

/** Set the unit from a profile or a choice, and remember it on the device. */
export function useUnits(units: string | null | undefined): void {
  setUnits(units);
  try { localStorage.setItem(UNIT_MEMORY_KEY, weightUnit()); } catch { /* storage disabled */ }
}

/** Before the first frame: the unit this device last used. */
export function restoreRememberedUnit(): void {
  try { restoreUnit(localStorage.getItem(UNIT_MEMORY_KEY)); } catch { /* no storage, as when prerendering */ }
}
