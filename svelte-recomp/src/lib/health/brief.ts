// What the watch says this week, against the person's own usual (2026-11-18:
// "disappointed that you aren't doing very much with my watch data"). Each
// signal is compared with the four weeks before, speaks only when the change
// is bigger than that person's normal wobble, and says what it means for the
// day and for the scale. Every number is worked out here, so the coach can
// quote it and its reply check still holds; the research behind each meaning
// travels in the coach's own instructions (supabase/functions/coach).
// The evidence, with sample sizes and limits: docs/learn/01-how-it-fits-together.md,
// "What the watch tells the coach". Pure; checked in selfcheck.js.
import { shiftYmd } from '../date.ts';

export type WatchKind = 'sleep' | 'steps' | 'resting_hr' | 'hrv';
export interface WatchFact {
  kind: WatchKind;
  /** This week's value: 7 nights or days (resting heart rate: 3 mornings). */
  week: number;
  /** The person's usual: the 28 days before this week. */
  usual: number;
  change: number;
  unit: string;
  /** Plain words, with every number the coach may quote. */
  says: string;
  /** HRV: the smallest change that matters for this person (half their SD). */
  swc?: number;
  /** Steps: calories a day the change is worth, low to high. */
  kcalLow?: number;
  kcalHigh?: number;
}

type Point = { date: string; value: number };
export interface WatchInput {
  today: string;
  /** Current weight (trend) in kg, for what steps are worth. */
  weightKg: number | null;
  sleep: Point[];
  steps: Point[];
  restingHr: Point[];
  hrv: Point[];
}

const day = (today: string, back: number) => shiftYmd(-back, new Date(`${today}T12:00:00`));
const within = (pts: Point[], today: string, from: number, to: number) => {
  const lo = day(today, from), hi = day(today, to);
  return pts.filter((p) => p.date >= lo && p.date <= hi && Number.isFinite(p.value) && p.value > 0).map((p) => p.value);
};
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
const r1 = (x: number) => Math.round(x * 10) / 10;
const r10 = (x: number) => Math.round(x / 10) * 10;


/** The watch facts worth saying today, most pressing first; [] when nothing changed. */
export function watchBrief(i: WatchInput): WatchFact[] {
  const out: { at: number; f: WatchFact }[] = [];

  // Resting heart rate: the last 3 mornings against the usual, beyond the
  // person's own day-to-day swing (at least 3 bpm).
  const hrUsual = within(i.restingHr, i.today, 34, 7);
  const hr3 = within(i.restingHr, i.today, 2, 0);
  const hr7 = within(i.restingHr, i.today, 6, 0);
  if (hrUsual.length >= 10 && hr3.length >= 2) {
    const u = mean(hrUsual), w = mean(hr3);
    if (w - u >= Math.max(3, sd(hrUsual))) {
      out.push({ at: 1, f: { kind: 'resting_hr', week: Math.round(w), usual: Math.round(u), change: Math.round(w - u), unit: 'bpm',
        says: `Resting heart rate is up: ${Math.round(w)} bpm over the last 3 mornings, against your usual ${Math.round(u)}. A short night, alcohol, a hard week or a cold coming on can each do it: an easier day is the safe choice.` } });
    } else if (hr7.length >= 4 && u - mean(hr7) >= 2) {
      const w7 = mean(hr7);
      out.push({ at: 8, f: { kind: 'resting_hr', week: Math.round(w7), usual: Math.round(u), change: Math.round(w7 - u), unit: 'bpm',
        says: `Resting heart rate is down to ${Math.round(w7)} bpm this week from your usual ${Math.round(u)}: the usual sign of fitness improving.` } });
    }
  }

  // Sleep: 7 nights (dated by the morning) against the usual.
  const slUsual = within(i.sleep, i.today, 34, 7);
  const slWeek = within(i.sleep, i.today, 6, 0);
  if (slUsual.length >= 10 && slWeek.length >= 4) {
    const u = r1(mean(slUsual)), w = r1(mean(slWeek));
    if (w < 6.5) {
      out.push({ at: 2, f: { kind: 'sleep', week: w, usual: u, change: r1(w - u), unit: 'h',
        says: `Sleep averaged ${w} h over the last 7 nights, against your usual ${u} h. Short nights tend to raise next-day eating: by about 385 kcal in lab studies, and sleeping about an hour longer cut it by about 270 kcal a day in a 4-week trial.` } });
    } else if (u - w >= 0.75) {
      out.push({ at: 5, f: { kind: 'sleep', week: w, usual: u, change: r1(w - u), unit: 'h',
        says: `Sleep is down: ${w} h a night over the last 7 nights, against your usual ${u} h.` } });
    } else if (w - u >= 0.75) {
      out.push({ at: 9, f: { kind: 'sleep', week: w, usual: u, change: r1(w - u), unit: 'h',
        says: `Longer nights: ${w} h over the last 7, against your usual ${u} h.` } });
    }
  }

  // HRV: 7-day average against the usual, beyond half the usual's SD.
  const hvUsual = within(i.hrv, i.today, 34, 7);
  const hvWeek = within(i.hrv, i.today, 6, 0);
  if (hvUsual.length >= 10 && hvWeek.length >= 4) {
    const u = mean(hvUsual), w = mean(hvWeek), swc = r1(0.5 * sd(hvUsual));
    if (swc > 0 && w < u - swc) {
      out.push({ at: 3, f: { kind: 'hrv', week: Math.round(w), usual: Math.round(u), change: Math.round(w - u), unit: 'ms', swc,
        says: `HRV averaged ${Math.round(w)} ms this week, below your usual ${Math.round(u)} ms by more than the ${swc} ms that matters for you: your body is still recovering, so keep training easy until it comes back.` } });
    } else if (swc > 0 && w > u + swc) {
      out.push({ at: 7, f: { kind: 'hrv', week: Math.round(w), usual: Math.round(u), change: Math.round(w - u), unit: 'ms', swc,
        says: `HRV is above your usual (${Math.round(w)} against ${Math.round(u)} ms): recovering well, a good week to train.` } });
    }
  }

  // Steps: the 7 full days before today (today is half walked) against the
  // usual, when the change is 1000 a day or more, with what it's worth.
  // Under 1000 steps is the watch off or unsynced, not a day of rest (the
  // owner's month had days of 10 and 47).
  const worn = i.steps.filter((p) => p.value >= 1000);
  const stUsual = within(worn, i.today, 35, 8);
  const stWeek = within(worn, i.today, 7, 1);
  if (stUsual.length >= 10 && stWeek.length >= 4) {
    const u = r10(mean(stUsual)), w = r10(mean(stWeek)), change = w - u;
    if (Math.abs(change) >= 1000) {
      const kg = i.weightKg ?? 80;
      const lo = r10((Math.abs(change) / 1000) * 0.75 * 0.5 * kg), hi = r10((Math.abs(change) / 1000) * 0.75 * 0.8 * kg);
      const minutes = Math.max(10, Math.round(Math.abs(change) / 100 / 5) * 5);
      out.push({ at: change < 0 ? 4 : 6, f: { kind: 'steps', week: w, usual: u, change, unit: 'steps', kcalLow: lo, kcalHigh: hi,
        says: change < 0
          ? `Steps averaged ${w} a day over the last 7 days, ${-change} fewer than your usual ${u}: roughly ${lo} to ${hi} kcal a day less burned. The week's budget catches up from the scale; a ${minutes}-minute walk makes up a day.`
          : `Steps averaged ${w} a day over the last 7 days, ${change} more than your usual ${u}: roughly ${lo} to ${hi} kcal a day more burned.` } });
    }
  }

  return out.sort((a, b) => a.at - b.at).map((x) => x.f);
}
