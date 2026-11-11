// THE EVENING HOLD: the evening's plan, the first time the phone is unlocked
// after the evening starts (MomentReceiver.java posts it; not an alarm).
//
// Asked for as something to stay strong through the evening, and a stronger
// signal when the weekend starts, because that's when a new habit meets the
// old one's pull. So it names the pull plainly and hands back the person's own
// plan and reason. It never shames: one
// evening that goes wrong is one meal, not the end of the habit. Reading a slip
// as "ruined anyway" is what turns one meal into a lost weekend.
//
// The quotes are George Long's translations of Epictetus and Marcus Aurelius:
// public domain everywhere (Long died in 1879), and each checked word for word
// against Project Gutenberg #10661 (Discourses) and #15877 (Thoughts) on
// 2026-10-17. One a day, picked by the date, never at random. Pure; see
// selfcheck.js.

import { CUES, type Plans, type PlanCue } from './plans.ts';

export interface Quote { text: string; who: string; where: string }

export const QUOTES: Quote[] = [
  { who: 'Epictetus', where: 'Discourses II.18', text: 'Every habit and faculty is maintained and increased by the corresponding actions: the habit of walking by walking, the habit of running by running.' },
  { who: 'Marcus Aurelius', where: 'Meditations IV.49', text: 'Be like the promontory against which the waves continually break, but it stands firm and tames the fury of the water around it.' },
  { who: 'Epictetus', where: 'Discourses II.18', text: 'Generally then if you would make anything a habit, do it; if you would not make it a habit, do not do it, but accustom yourself to do something else in place of it.' },
  { who: 'Marcus Aurelius', where: 'Meditations X.16', text: 'No longer talk at all about the kind of man that a good man ought to be, but be such.' },
  // Long: "Nothing great, said Epictetus, is produced suddenly…" (speech tag dropped).
  { who: 'Epictetus', where: 'Discourses I.15', text: 'Nothing great is produced suddenly, since not even the grape or the fig is.' },
  { who: 'Marcus Aurelius', where: 'Meditations VIII.36', text: 'Do not disturb thyself by thinking of the whole of thy life.' },
  { who: 'Epictetus', where: 'Discourses II.18', text: 'This is the true athlete, the man who exercises himself against such appearances.' },
  { who: 'Marcus Aurelius', where: 'Meditations V.16', text: 'Such as are thy habitual thoughts, such also will be the character of thy mind; for the soul is dyed by the thoughts.' },
  { who: 'Epictetus', where: 'Discourses II.18', text: 'For the habit at first begins to be weakened, and then is completely destroyed.' },
];

/** Friday always gets the same line: the weekend's signal is a ritual. */
export const FRIDAY_QUOTE: Quote = {
  who: 'Epictetus', where: 'Discourses II.18',
  text: 'Great is the combat, divine is the work; it is for kingship, for freedom, for happiness, for freedom from perturbation.',
};

const dowOf = (date: string) => new Date(`${date}T12:00:00`).getDay();

export function quoteFor(date: string): Quote {
  if (dowOf(date) === 5) return FRIDAY_QUOTE;
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return QUOTES[day % QUOTES.length];
}

/** When the evening starts, minutes from midnight: 17:00 Friday to Sunday,
 *  when the weekend's pull starts, 19:30 on other days. It ends at 23:00;
 *  later than that it isn't the evening's message any more. */
export function holdAfter(dow: number): number {
  return dow === 5 || dow === 6 || dow === 0 ? 17 * 60 : 19 * 60 + 30;
}
export const HOLD_UNTIL = 23 * 60;

export interface HoldInput {
  date: string;
  plans: Plans | null;
  why: string | null;
  sportDay: boolean;
  /** The day so far: logged kcal and protein, against its share of the week
   *  and the protein target. null when it isn't today's. */
  food: { kcal: number; share: number | null; proteinG: number; proteinTargetG: number | null } | null;
}

const kcal = (n: number) => Math.round(n).toLocaleString('en-US');

export function composeHold(i: HoldInput): { date: string; title: string; body: string } {
  const dow = dowOf(i.date);
  const weekend = dow === 6 || dow === 0;
  const q = quoteFor(i.date);
  const quote = `“${q.text}” — ${q.who}`;

  // The evening's own plan: the most specific moment first.
  const cue = ([i.sportDay ? 'badminton' : null, dow === 5 ? 'friday' : null, weekend ? 'weekend' : null, 'evening'] as Array<PlanCue | null>)
    .find((c): c is PlanCue => c != null && !!i.plans?.[c]?.trim());
  const plan = cue ? `${CUES.find((c) => c.cue === cue)!.label}: ${i.plans![cue]!.trim()}` : null;

  let food: string | null = null;
  const f = i.food;
  if (f && f.kcal > 0) {
    const protein = f.proteinTargetG != null ? Math.round(f.proteinTargetG - f.proteinG) : 0;
    if (f.share != null && f.share - f.kcal > 0) {
      food = `Left today: ${kcal(f.share - f.kcal)} kcal${protein >= 20 ? `, ${protein} g of it protein` : ''}.`;
    } else if (f.share != null) {
      food = `Today's share is eaten.${protein >= 20 ? ` Protein is still ${protein} g short.` : ''}`;
    } else if (protein >= 20) {
      food = `Protein is still ${protein} g short.`;
    }
  }

  const why = i.why?.trim() ? `You said: “${i.why.trim()}”` : null;
  const lines = dow === 5 || weekend
    ? [dow === 5 ? 'The weekend is where old habits pull hardest. You’re building a new one.'
        : 'The pull is strongest now. One evening at a time: a slip is one meal, not the weekend.',
      plan, why, food, quote]
    : [quote, plan, food];

  const title = dow === 5 ? 'Friday. The weekend starts now.'
    : dow === 6 ? 'Saturday evening. Hold through.'
    : dow === 0 ? 'Sunday evening. Finish the week.'
    : 'Evening. Hold it.';
  return { date: i.date, title, body: lines.filter(Boolean).join('\n') };
}
