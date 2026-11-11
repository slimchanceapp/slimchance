// Training consistency heatmap (GitHub-style calendar).
//
// Streaks answer "am I on a run right now"; this answers "what does the last few
// months actually LOOK like" — the density of training over time, gaps and all.
// It turns every logged lifting session and watch-recorded activity into a
// day-shaded grid, which is the single most honest picture of consistency.
//
// Pure — no Svelte/Dexie — unit-tested in selfcheck.js.

export interface HeatCell {
  date: string;    // YMD; '' for padding cells before the range starts
  count: number;   // sessions that day
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Heatmap {
  weeks: HeatCell[][];   // columns of 7 (Sun..Sat), oldest→newest, for rendering
  daysTrained: number;
  totalSessions: number;
  activeWeeks: number;    // weeks with >=1 session
  windowWeeks: number;
  bestDayCount: number;
}

function ymd(dt: Date): string { return dt.toISOString().slice(0, 10); }
function parse(ymdStr: string): Date { const [y, m, d] = ymdStr.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); }

function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

/**
 * @param sessionDates  A YMD for every training event (repeat a date to count
 *                      multiple sessions that day). Lifting + activity combined.
 * @param opts.windowWeeks  How many weeks back to show (default 26).
 * @param opts.asOf     "today" as YMD; defaults to the max date present, else now.
 */
export function trainingHeatmap(
  sessionDates: string[],
  opts: { windowWeeks?: number; asOf?: string } = {},
): Heatmap {
  const windowWeeks = opts.windowWeeks ?? 26;
  const counts = new Map<string, number>();
  for (const d of sessionDates) if (d) counts.set(d, (counts.get(d) || 0) + 1);

  const maxDate = opts.asOf || [...counts.keys()].sort().pop() || ymd(new Date());
  const end = parse(maxDate);
  // End the grid on the Saturday of the current week so columns are whole weeks.
  const endSat = new Date(end); endSat.setUTCDate(endSat.getUTCDate() + (6 - endSat.getUTCDay()));
  const totalDays = windowWeeks * 7;
  const start = new Date(endSat); start.setUTCDate(start.getUTCDate() - (totalDays - 1));

  const weeks: HeatCell[][] = [];
  let daysTrained = 0, totalSessions = 0, bestDayCount = 0;
  const activeWeekSet = new Set<number>();

  for (let w = 0; w < windowWeeks; w++) {
    const col: HeatCell[] = [];
    for (let day = 0; day < 7; day++) {
      const cur = new Date(start); cur.setUTCDate(start.getUTCDate() + w * 7 + day);
      const key = ymd(cur);
      const inFuture = cur > end;
      const count = inFuture ? 0 : (counts.get(key) || 0);
      if (count > 0) {
        daysTrained++; totalSessions += count; activeWeekSet.add(w);
        if (count > bestDayCount) bestDayCount = count;
      }
      col.push({ date: inFuture ? '' : key, count, level: levelFor(count) });
    }
    weeks.push(col);
  }

  return {
    weeks,
    daysTrained,
    totalSessions,
    activeWeeks: activeWeekSet.size,
    windowWeeks,
    bestDayCount,
  };
}
