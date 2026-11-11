// How recovered each muscle is since it was last trained (Train's recovery
// view): per-muscle windows, longer for high-eccentric lifts. Moved out of
// readiness.ts on 2026-11-11: it is Training's language, not the morning read.
// Pure.

// — Per-muscle recovery windows (BASE hours to full recovery) —
// Evidence-based, trained-individual, moderate-volume baselines. Trained
// lifters doing habitual work recover far faster than the old flat 72h:
// myofibrillar MPS returns to ~baseline by ~36h in trained subjects
// (MacDougall 1995), and 2×/week frequency beating 1×/week (Schoenfeld
// 2016 meta) proves muscles are ready well inside 72h. Larger, high-EIMD
// groups still sit higher; small/endurance groups recover fastest.
// Actual window = base × exerciseModifier() (see below) so a low-damage
// isolation move (leg extension) recovers much faster than a high-eccentric
// compound (RDL) hitting the same muscle.
export const MUSCLE_RECOVERY_HOURS: Record<string, number> = {
  Quads: 60, Hamstrings: 60, Glutes: 54, Back: 54,
  Chest: 54, Shoulders: 42, Triceps: 42, Biceps: 42, Calves: 42,
  Core: 30,
};

/**
 * Exercise-type recovery modifier (multiplies the base per-muscle window).
 * Heavy-eccentric compounds load the muscle at long lengths → most damage →
 * slowest recovery (Proske & Morgan 2001); machine/isolation moves have a
 * short eccentric ROM → least damage → fastest. This is what makes an RDL
 * legitimately need ~72h for hamstrings while a leg extension needs ~45h for
 * quads, instead of a misleading flat 72h for both.
 */
export function exerciseModifier(name: string): number {
  const n = (name || '').toLowerCase();
  // High-eccentric / long-length compounds → longer recovery.
  if (/\brdl\b|romanian|dead\s?lift|deadlift|nordic|good\s?morning|stiff.?leg|\bsquat\b|split squat|lunge|weighted (pull|chin)|pull.?up|chin.?up/.test(n)) return 1.25;
  // Isolation / machine / short-ROM → shorter recovery.
  if (/extension|curl|\bfly|flye|pushdown|press.?down|kickback|raise|pec deck|cable|machine|crunch|lateral|rear delt|calf/.test(n)) return 0.75;
  // Standard compound (bench, row, OHP, hip thrust, leg press, pulldown).
  return 1.0;
}

export type RecoveryStatus = 'fatigued' | 'recovering' | 'ready' | 'none';

/**
 * Recovery state for a muscle given how long ago it was last trained and
 * that muscle's recovery window. Returns a 0–100% recovery estimate and
 * the hours remaining until "ready", so the UI can SHOW the reason
 * ("Ready in ~32h") rather than an opaque label.
 */
export function recoveryState(hoursAgo: number | null, windowH: number): {
  status: RecoveryStatus; pct: number; readyInH: number;
} {
  if (hoursAgo == null) return { status: 'none', pct: 0, readyInH: 0 };
  const pct = Math.max(0, Math.min(100, Math.round((hoursAgo / windowH) * 100)));
  const readyInH = Math.max(0, Math.round(windowH - hoursAgo));
  let status: RecoveryStatus;
  if (hoursAgo >= windowH) status = 'ready';
  else if (hoursAgo >= windowH * 0.5) status = 'recovering';
  else status = 'fatigued';
  return { status, pct, readyInH };
}
