// A kind word, earned by showing up (the owner, 2026-10-31: "rewards, in the
// sense of a kind word or motivation, is not a bad thing"). It is worked out
// from the dates someone stepped on the scale and nothing else, so it can
// never know which way the number went: praise for a lower morning would make
// the next higher one a scolding. Most days it says nothing, because words
// that come every morning stop meaning anything.
import { shiftYmd } from '../date.ts';

/** Two missed mornings are a busy week; three are a gap worth coming back from. */
const GAP_DAYS = 4;

export function kindWord(dates: string[], today: string, mornings: { weighed: number; days: number }): string | null {
  const days = [...new Set(dates)].sort();
  if (!days.includes(today)) return null;
  const before = days.filter((d) => d < today);
  if (!before.length) return 'Your first morning. Same time tomorrow, before food or drink.';
  if (before.at(-1)! < shiftYmd(-(GAP_DAYS - 1), new Date(`${today}T12:00:00`))) {
    return 'Good to see you back. A gap costs a few mornings, never the trend.';
  }
  if (mornings.weighed === 5) return 'Five mornings this week. That’s what makes the trend worth trusting.';
  return null;
}
