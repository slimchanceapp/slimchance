// "Why is the scale up?": the morning most people give up.
//
// A reading above yesterday's, or well above the trend, is nearly always
// water and food in transit: a bigger day, the weekend, a hard new session,
// salt, a late meal. The scale can't say which; the person's own log often
// can. So when a morning reads high, the app says what it can see in their
// own data, says nothing it can't see, and ends with what the trend did, the
// number that counts. A day that's merely inside the usual swing gets told
// exactly that. Pure; see selfcheck.js.

import { dwt, wt } from '../units.ts';

export interface UpInput {
  today: string;
  /** This morning's reading, kg. */
  kg: number;
  /** The last reading before today. */
  prev: { date: string; kg: number } | null;
  /** The trend with this morning in it, and without it. */
  trendKg: number | null;
  trendPrevKg: number | null;
  /** How far mornings usually sit from the trend, ± kg. */
  scatterKg: number | null;
  intake: Map<string, { kcal: number }>;
  /** Each weekday's usual reading against the trend, kg, Monday first (week.ts weekShape). */
  weekdayOffsets: (number | null)[] | null;
  /** Days with training in them. */
  trained: Set<string>;
  /** Period-aware weight, when it's on and today is near a period (cycle.ts). */
  cycleNote?: string | null;
}

export interface UpExplained { title: string; reasons: string[]; trend: string }

const DAY = 86400000;
const shift = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00`); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round10 = (n: number) => (Math.round(n / 10) * 10).toLocaleString('en-GB');

export function explainUp(i: UpInput): UpExplained | null {
  const yesterday = shift(i.today, -1);
  const gapDays = i.prev ? Math.round((Date.parse(`${i.today}T12:00:00`) - Date.parse(`${i.prev.date}T12:00:00`)) / DAY) : null;
  const up = i.prev && gapDays != null && gapDays <= 3 ? i.kg - i.prev.kg : null;
  const over = i.trendKg != null ? i.kg - i.trendKg : null;
  if (!((up != null && up >= 0.4) || (over != null && over >= 0.5))) return null;

  const title = up != null && up >= 0.4
    ? `Up ${dwt(up)} from ${i.prev!.date === yesterday ? 'yesterday' : weekday(i.prev!.date)}`
    : `${dwt(over!)} above your trend`;

  const reasons: string[] = [];
  // 1. Yesterday's food against the person's own usual day (the last four
  // weeks of logged days, today and yesterday aside).
  const y = i.intake.get(yesterday)?.kcal ?? null;
  const usualDays = [...i.intake].filter(([d, v]) => d < yesterday && d >= shift(i.today, -29) && v.kcal >= 800).map(([, v]) => v.kcal);
  if (y != null && usualDays.length >= 7) {
    const usual = median(usualDays);
    if (y - usual >= 350) reasons.push(`Yesterday you logged ${round10(y)} kcal, about ${round10(y - usual)} more than your usual day. A bigger day holds extra food and water in you for a day or two.`);
  }
  if (i.cycleNote) reasons.push(i.cycleNote);
  // 2. The person's own weekly rhythm.
  const dow = (new Date(`${i.today}T12:00:00`).getDay() + 6) % 7;
  const off = i.weekdayOffsets?.[dow] ?? null;
  if (off != null && off >= 0.3) reasons.push(`Your ${weekday(i.today)} mornings usually read ${dwt(off)} above your trend${dow <= 1 ? ': the weekend is still passing through' : ''}.`);
  // 3. New training after a break: working muscles hold water for days.
  const lastTrained = [yesterday, shift(i.today, -2)].find((d) => i.trained.has(d));
  if (lastTrained) {
    let before = 0;
    for (let k = 1; k <= 14 && !i.trained.has(shift(lastTrained, -k)); k++) before = k;
    if (before >= 5) reasons.push(`${lastTrained === yesterday ? 'Yesterday' : weekday(lastTrained)} was your first training in ${before >= 14 ? 'two weeks' : `${before + 1} days`}. Muscles hold extra water for a few days after new work, so the scale rises while the fat doesn't.`);
  }
  if (!reasons.length) {
    // The first mornings: no swing of their own to compare with, and often no
    // log yet. Morning two is where the app first shows what it's for.
    const logged = [...i.intake].some(([d, v]) => d >= shift(i.today, -14) && v.kcal > 0);
    reasons.push(i.trendKg == null
      ? 'Normal in the first days: most mornings move up to a kilo either way, from water, salt and what’s still being digested. That’s why Slim Chance waits for a week of mornings before it calls a trend.'
      : over != null && over < 0.05
        ? 'This morning is at or below your trend: yesterday was simply a low one.'
        // Quote the band the morning was judged by (twice the usual scatter),
        // or the words contradict the number on screen.
        : i.scatterKg != null && over != null && over <= i.scatterKg * 2
        ? `This morning sits ${dwt(over)} above your trend, and your mornings usually land within about ${dwt(i.scatterKg * 2)} of it: a normal swing.`
        : logged
          ? 'Nothing in your log explains it. Salt, a late meal, a short night or a slower gut all move the scale and leave no trace in a log.'
          : 'Salt, a late meal, a short night or a slower gut all move the scale for a day or two.');
  }

  let trend = '';
  if (i.trendKg != null) {
    const moved = i.trendPrevKg != null ? i.trendKg - i.trendPrevKg : null;
    trend = moved == null || Math.abs(moved) < 0.05
      ? `Your trend held at ${wt(i.trendKg)}.`
      : `Your trend moved ${moved > 0 ? 'up' : 'down'} ${dwt(moved)}, to ${wt(i.trendKg)}.`;
    trend += ' One morning is noise; the trend is the number.';
  }
  return { title, reasons: reasons.slice(0, 3), trend };
}
