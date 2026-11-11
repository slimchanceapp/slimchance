// YOUR CEILING (the "line" in code) — the weight the trend doesn't go back above.
//
// The one long trial that taught people to KEEP weight off (STOP Regain, Wing
// et al., NEJM 2006) didn't run on willpower. It ran on a daily weigh-in and a
// line: within 3 lb of where you started was green, 3–4 lb over was yellow,
// 5 lb or more was red — and each colour came with something you'd already
// agreed to do. 46% of the face-to-face group regained 5 lb+ in 18 months,
// against 72% of controls. Here amber starts ~1 kg (2.2 lb) over the held low
// and red ~2 kg (4.4 lb) over: the same bands, a little earlier.
//
// Here the line is drawn 1 kg above today's trend, and it only ever moves DOWN:
// each time a lower trend holds for a week, the line follows it to 1 kg above.
// So every kilo lost is a kilo the line now guards. It is never raised for you.
//
// Judged on the trend (stores/body), never on one morning: a Monday after the
// weekend reads ~0.5 kg heavy on its own, and a line that fired on that would
// teach you to ignore it. Pure; see selfcheck.js.

import { weightVerdict, type WeighIn } from './insights.ts';

export interface LineSetting {
  /** Where the user drew it. */
  kg: number;
  /** The day it was drawn (YYYY-MM-DD) — the ratchet looks at trends from here on. */
  set: string;
}

export type LineZone = 'under' | 'over' | 'well-over';

export interface LineState {
  /** The line now: the drawn line, or 1 kg above the lowest trend that held a
   *  week since, whichever is lower. */
  kg: number;
  /** The lowest trend that held for a full week since the line was drawn. */
  heldLowKg: number | null;
  trendKg: number;
  /** trend − line, kg; positive is over. */
  overKg: number;
  zone: LineZone;
  /** Drawn below the trend of the day it was drawn: that's a target, not a
   *  ceiling (people typed their next goal here). */
  misdrawn: boolean;
}

/** How far above the lowest held trend the line sits. */
export const LINE_MARGIN_KG = 1;
/** Over the line by more than this is "well over" — STOP Regain's red. */
export const WELL_OVER_KG = 1;
/** A low has to hold this many days before the line follows it. */
const HOLD_DAYS = 7;
/** Look back at most this far for the ratchet (performance, nothing more). */
const MAX_DAYS = 3 * 366;

const DAY = 86400000;
const noon = (ymd: string) => Date.parse(`${ymd}T12:00:00`);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Where to suggest drawing a new line: 1 kg above today's trend. */
export function suggestLine(trendKg: number): number {
  return round1(trendKg + LINE_MARGIN_KG);
}

export function lineState(setting: LineSetting | null | undefined, weights: WeighIn[], today: string): LineState | null {
  if (!setting || !(setting.kg > 0) || !setting.set) return null;
  const end = noon(today);
  const trendAt = (t: number) => weightVerdict(weights, t)?.trendKg ?? null;
  const trendKg = trendAt(end);
  if (trendKg == null) return null;

  // The lowest week-long hold: the max over each 7-day stretch is a low that
  // held; the min of those is the lowest that did. One noisy dip can't move it.
  const start = Math.max(noon(setting.set), end - MAX_DAYS * DAY);
  let heldLow: number | null = null;
  const run: number[] = [];
  for (let t = start; t <= end; t += DAY) {
    const v = trendAt(t);
    if (v == null) { run.length = 0; continue; }
    run.push(v);
    if (run.length > HOLD_DAYS) run.shift();
    if (run.length === HOLD_DAYS) {
      const held = Math.max(...run);
      if (heldLow == null || held < heldLow) heldLow = held;
    }
  }

  const kg = round1(Math.min(setting.kg, heldLow != null ? heldLow + LINE_MARGIN_KG : Infinity));
  const overKg = round1(trendKg - kg);
  const atSet = trendAt(noon(setting.set));
  return {
    kg, heldLowKg: heldLow, trendKg, overKg,
    zone: overKg <= 0 ? 'under' : overKg <= WELL_OVER_KG ? 'over' : 'well-over',
    misdrawn: atSet != null && setting.kg < atSet - 0.5,
  };
}
