// Stalled-lift detector + progressive-overload report.
//
// strength.ts answers the aggregate question ("are my lifts holding overall?").
// This answers the actionable per-lift one: WHICH lift has stopped moving, for
// how long, and what to do about it. The honest signal is estimated 1-rep-max
// (Epley) per session: if a lift hasn't set a new best e1RM in several sessions
// and the recent trend is flat or down, it's stalled — the cue for a small
// deload, a rep-range change, or a technique/effort check, long before it
// becomes a plateau you've sat on for months.
//
// Pure — no Svelte/Dexie — unit-tested in selfcheck.js.

import type { StrengthLog, StrengthSet } from './strength';

/** Epley estimated 1-rep-max: weight × (1 + reps/30). Inlined (not imported)
 *  so this module has no runtime dependency on strength.ts. */
function estOneRM(reps: number, weight: number): number {
  return weight * (1 + reps / 30);
}

export interface LiftStatus {
  exercise: string;
  sessions: number;            // number of logged sessions for this lift
  currentBestE1RM: number;     // best e1RM in the most recent session
  allTimeBestE1RM: number;
  sessionsSincePR: number;     // sessions since the all-time best was set
  trendPct: number;            // % change in e1RM, first->last session (rounded)
  stalled: boolean;
  progressing: boolean;
  suggestion: string;
}

export interface StallReport {
  lifts: LiftStatus[];
  stalled: LiftStatus[];
  progressing: LiftStatus[];
  headline: string | null;
}

/** Best (max) e1RM among a session's working sets. null if none valid. */
function sessionBestE1RM(sets: StrengthSet[]): number | null {
  let best: number | null = null;
  for (const s of sets || []) {
    if (s.reps == null || s.weight_kg == null || s.reps <= 0 || s.weight_kg <= 0) continue;
    const rm = estOneRM(s.reps, s.weight_kg);
    if (best == null || rm > best) best = rm;
  }
  return best;
}

/**
 * @param logs             All logged sessions across lifts.
 * @param opts.stallAfter  Sessions without a new PR before it's "stalled" (default 3).
 * @param opts.minSessions Ignore lifts with fewer sessions than this (default 3).
 */
export function liftStalls(
  logs: StrengthLog[],
  opts: { stallAfter?: number; minSessions?: number } = {},
): StallReport {
  const stallAfter = opts.stallAfter ?? 3;
  const minSessions = opts.minSessions ?? 3;

  // Group sessions by exercise, each session -> its best e1RM, in date order.
  const byLift = new Map<string, Array<{ date: string; e1rm: number }>>();
  for (const log of logs) {
    const best = sessionBestE1RM(log.sets);
    if (best == null || !log.exercise_name) continue;
    const arr = byLift.get(log.exercise_name) || [];
    arr.push({ date: log.date, e1rm: best });
    byLift.set(log.exercise_name, arr);
  }

  const lifts: LiftStatus[] = [];
  for (const [exercise, rawArr] of byLift) {
    const arr = rawArr.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (arr.length < minSessions) continue;

    let allTimeBest = -Infinity, allTimeBestIdx = 0;
    arr.forEach((p, i) => { if (p.e1rm > allTimeBest) { allTimeBest = p.e1rm; allTimeBestIdx = i; } });
    const sessionsSincePR = arr.length - 1 - allTimeBestIdx;
    const first = arr[0].e1rm, last = arr[arr.length - 1].e1rm;
    const trendPct = first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0;

    const stalled = sessionsSincePR >= stallAfter;
    const progressing = allTimeBestIdx === arr.length - 1 || (sessionsSincePR <= 1 && trendPct > 1);

    let suggestion: string;
    if (progressing) suggestion = `Still climbing (+${trendPct}% e1RM). Keep adding load or reps.`;
    else if (stalled) suggestion = `No PR in ${sessionsSincePR} sessions. Drop ~10% and build back, or change the rep range.`;
    else suggestion = `Flat lately — push for one more rep or a small load bump next session.`;

    lifts.push({
      exercise,
      sessions: arr.length,
      currentBestE1RM: Math.round(last),
      allTimeBestE1RM: Math.round(allTimeBest),
      sessionsSincePR,
      trendPct,
      stalled,
      progressing,
      suggestion,
    });
  }

  lifts.sort((a, b) => b.sessionsSincePR - a.sessionsSincePR);
  const stalled = lifts.filter((l) => l.stalled);
  const progressing = lifts.filter((l) => l.progressing);

  let headline: string | null = null;
  if (lifts.length === 0) headline = null;
  else if (stalled.length > 0) headline = `${stalled.length} lift${stalled.length === 1 ? '' : 's'} stalled — ${stalled.slice(0, 2).map((l) => l.exercise).join(', ')}. Time to change something.`;
  else if (progressing.length > 0) headline = `${progressing.length} of ${lifts.length} tracked lifts are still progressing. Momentum's good.`;
  else headline = 'No stalls, but nothing setting PRs either — nudge the loads up.';

  return { lifts, stalled, progressing, headline };
}
