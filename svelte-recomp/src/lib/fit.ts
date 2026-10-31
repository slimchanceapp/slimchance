// "Is Slim Chance for you?", asked once, from the third day of the first week
// to the seventh, of people who finished setup (2026-10-31). Of the strangers
// who logged anything, seven in eight left within four entries and nobody
// said why. The answer and the reason are counted like the setup steps:
// totals only (src/lib/events.ts).
import { shiftYmd } from './date.ts';

export const FIT_ANSWERS = [
  { event: 'fit_yes', label: 'Yes, so far' },
  { event: 'fit_unsure', label: 'Not sure yet' },
  { event: 'fit_no', label: 'No' },
] as const;

export const FIT_REASONS = [
  { event: 'why_logging', label: 'Too much to log' },
  { event: 'why_scale', label: 'The scale stresses me' },
  { event: 'why_plan', label: 'I wanted a meal plan' },
  { event: 'why_confusing', label: 'It’s confusing' },
  { event: 'why_broken', label: 'Something didn’t work' },
  { event: 'why_other', label: 'Something else' },
] as const;

/** `joined` is the local date the account began. */
export function fitAskDue(i: { joined: string | null; today: string; setupDone: boolean; answered: boolean }): boolean {
  if (!i.joined || !i.setupDone || i.answered) return false;
  const noon = new Date(`${i.today}T12:00:00`);
  return i.joined <= shiftYmd(-2, noon) && i.joined >= shiftYmd(-6, noon);
}
