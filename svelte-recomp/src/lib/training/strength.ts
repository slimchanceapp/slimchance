// Strength / muscle-retention intelligence.
//
// The app already logs every set (reps × weight). During a calorie deficit —
// especially a fast, GLP-1-assisted one — the question that actually matters
// isn't "how much do I weigh" but "am I keeping the muscle while the fat
// leaves?". The honest proxy for that is: are the main lifts holding or
// climbing? This module turns the raw set history into that verdict.

export interface StrengthSet {
  reps: number | null;
  weight_kg: number | null;
}
export interface StrengthLog {
  date: string; // YYYY-MM-DD
  exercise_name: string;
  sets: StrengthSet[];
}

/** Epley estimated 1-rep-max — lets sets of different rep ranges be compared
 *  on a level footing. weight × (1 + reps/30). */
export function estOneRM(reps: number, weight: number): number {
  return weight * (1 + reps / 30);
}

/** Best (highest e1RM) set within a single session. null if no valid set. */
export function bestE1RM(sets: StrengthSet[]): number | null {
  let best: number | null = null;
  for (const s of sets || []) {
    if (s.reps == null || s.weight_kg == null || s.weight_kg <= 0 || s.reps <= 0) continue;
    const rm = estOneRM(s.reps, s.weight_kg);
    if (best == null || rm > best) best = rm;
  }
  return best;
}

export interface StrengthTrend {
  /** 'up' | 'holding' | 'down' — the muscle-retention verdict, or
   *  'insufficient' when there isn't enough history to say honestly. */
  direction: 'up' | 'holding' | 'down' | 'insufficient';
  /** Average % change in e1RM across comparable lifts (recent vs prior window). */
  avgPct: number;
  /** How many comparable lifts improved / slipped. */
  liftsUp: number;
  liftsDown: number;
  /** Lifts that could be compared across both windows. */
  comparableLifts: number;
  /** The single lift with the biggest move (for a concrete, name-able example). */
  topMover: { name: string; pct: number } | null;
  /** Window length used, in days. */
  windowDays: number;
}

const DAY_MS = 86400000;
function dateMs(d: string): number {
  return new Date(d + 'T12:00:00').getTime();
}

/**
 * Compare each exercise's best e1RM in the recent window vs the window before
 * it, then aggregate into one verdict.
 *
 * - A lift is "comparable" only if it has at least one session in BOTH windows.
 * - Needs >= 2 comparable lifts and a real span, else 'insufficient' (we never
 *   fake a muscle verdict off a single noisy data point).
 */
export function strengthTrend(
  logs: StrengthLog[],
  opts: { asOf?: number; windowDays?: number } = {}
): StrengthTrend {
  const windowDays = opts.windowDays ?? 21;
  const asOf = opts.asOf ?? Date.now();
  const recentStart = asOf - windowDays * DAY_MS;
  const priorStart = asOf - 2 * windowDays * DAY_MS;

  const empty: StrengthTrend = {
    direction: 'insufficient', avgPct: 0, liftsUp: 0, liftsDown: 0,
    comparableLifts: 0, topMover: null, windowDays,
  };
  if (!logs || logs.length === 0) return empty;

  // exercise -> best e1RM in each window
  const byEx = new Map<string, { recent: number | null; prior: number | null }>();
  for (const log of logs) {
    const e = bestE1RM(log.sets);
    if (e == null) continue;
    const t = dateMs(log.date);
    if (t > asOf) continue;
    const rec = byEx.get(log.exercise_name) ?? { recent: null, prior: null };
    if (t > recentStart) {
      if (rec.recent == null || e > rec.recent) rec.recent = e;
    } else if (t > priorStart) {
      if (rec.prior == null || e > rec.prior) rec.prior = e;
    }
    byEx.set(log.exercise_name, rec);
  }

  let sumPct = 0, comparable = 0, up = 0, down = 0;
  let topMover: { name: string; pct: number } | null = null;
  for (const [name, w] of byEx) {
    if (w.recent == null || w.prior == null || w.prior <= 0) continue;
    const pct = ((w.recent - w.prior) / w.prior) * 100;
    comparable++;
    sumPct += pct;
    if (pct > 1) up++;
    else if (pct < -2) down++;
    if (topMover == null || Math.abs(pct) > Math.abs(topMover.pct)) topMover = { name, pct: +pct.toFixed(1) };
  }

  if (comparable < 2) return { ...empty, comparableLifts: comparable };

  const avgPct = +(sumPct / comparable).toFixed(1);
  let direction: StrengthTrend['direction'];
  if (avgPct >= 1.5) direction = 'up';
  else if (avgPct <= -3) direction = 'down';
  else direction = 'holding';

  return { direction, avgPct, liftsUp: up, liftsDown: down, comparableLifts: comparable, topMover, windowDays };
}
