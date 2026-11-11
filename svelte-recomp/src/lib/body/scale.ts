// The morning weigh-in: the five seconds a day everything else is built on.
//
// What lasts, in the studies of people who kept weight off, is not a streak —
// it's coming back. Missing a morning barely matters (habit formation shrugs
// off a single miss, Lally et al. 2010); what matters is that the next morning
// is a normal one, not a reckoning. So nothing here ever resets to zero: the
// week counts its mornings and starts fresh on Monday, and stepping back on
// the scale after a gap is welcomed, not scored. Pure; see selfcheck.js.

import { mondayOf } from '../date.ts';
import { dwt, wt, wtNum } from '../units.ts';

export interface Said { key: string; title: string; body: string; icon: string; ttl?: number }

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000);

/** Mornings weighed this week (Monday..today) and the mornings so far. */
export function morningsThisWeek(weights: Array<{ date: string }>, today: string): { weighed: number; days: number } {
  const monday = mondayOf(new Date(`${today}T12:00:00`));
  // A week someone started part-way through counts from their first morning:
  // "2/5" on day two read as three missed mornings they were never here for.
  const first = weights.reduce((m, w) => (w.date < m ? w.date : m), today);
  const start = first > monday ? first : monday;
  const weighed = new Set(weights.filter((w) => w.date >= start && w.date <= today).map((w) => w.date)).size;
  return { weighed, days: daysBetween(start, today) + 1 };
}

/** What a weigh-in earns, if anything: the goal, a comeback, a new low. */
export function weighInMessage(kg: number, ctx: {
  today: string; weights: Array<{ date: string; weight: number }>; goalKg: number | null; startKg: number | null;
}): Said | null {
  const prior = ctx.weights.filter((w) => w.date < ctx.today).sort((a, b) => a.date.localeCompare(b.date));
  const priorLow = prior.length ? Math.min(...prior.map((w) => +w.weight)) : null;
  const goal = ctx.goalKg ?? 0;

  if (goal > 0 && kg <= goal + 0.05 && (priorLow == null || priorLow > goal + 0.05)) {
    return { key: `goal-reached-${kg}`, title: 'Goal weight reached 🎯', icon: '🎯', ttl: 10000,
      body: `${wt(kg)} — you did the thing. Now your line guards it.` };
  }
  const newLow = priorLow != null && kg < priorLow - 0.05 && (goal === 0 || kg > goal);
  const gap = prior.length ? daysBetween(prior[prior.length - 1].date, ctx.today) : 0;
  if (gap >= 4) {
    return { key: `comeback-${ctx.today}`, title: 'Back on the scale', icon: '👋',
      body: `${gap} days since the last one${newLow ? ` — and the lowest you've logged` : ''}. Nothing to make up: the trend picks up where it left off.` };
  }
  if (newLow) {
    const fromStart = ctx.startKg != null && ctx.startKg > kg ? ` — down ${dwt(ctx.startKg - kg)} from ${wtNum(ctx.startKg)}` : '';
    return { key: `low-${kg}`, title: `New low: ${wt(kg)} 📉`, icon: '📉',
      body: `Lowest you've logged${fromStart}. One morning is noise — the trend is what to watch.` };
  }
  return null;
}

/**
 * A reading this far off the trend is far more often a typo (83.5 for 93.5)
 * than a body, and a typo is expensive: it bends the trend — and so the line
 * and the target — for five weeks. So it asks once before it saves.
 */
export const OFF_TREND_KG = 3.5;

/** How far off the trend a reading is, when that's far enough to ask; else null. */
export function offTrend(kg: number, trendKg: number | null): number | null {
  if (trendKg == null || !(kg > 0)) return null;
  const d = Math.round((kg - trendKg) * 10) / 10;
  return Math.abs(d) > OFF_TREND_KG ? d : null;
}
