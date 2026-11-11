// Slim Chance teaches as it happens (the owner, 2026-10-31: "build Slim Chance
// to teach people how to lose weight"). Each lesson arrives on the day it is
// needed and is shown once; the first up morning has its own card already
// (scaleUp.ts). Today shows a lesson only when nothing more urgent is waiting.

export type LessonId = 'first-odds' | 'first-stall';
export interface Lesson { id: LessonId; title: string; body: string; href?: string; cta?: string }

/** The first odds are news only to someone who just got them. */
const NEW_DAYS = 21;

export function lessonFor(i: { today: string; firstWeighIn: string | null; odds: boolean; stalled: boolean; seen: Set<string> }): Lesson | null {
  const daysIn = i.firstWeighIn ? (Date.parse(`${i.today}T12:00:00`) - Date.parse(`${i.firstWeighIn}T12:00:00`)) / 864e5 : null;
  if (i.odds && daysIn != null && daysIn <= NEW_DAYS && !i.seen.has('first-odds')) {
    return {
      id: 'first-odds', title: 'Your first odds',
      body: 'Ten coins: how sure Slim Chance is that your weight is really going your way, not just wobbling. Every morning on the scale makes them firmer.',
    };
  }
  if (i.stalled && !i.seen.has('first-stall')) {
    return {
      id: 'first-stall', title: 'Flat for a while? That’s normal',
      body: 'Most people’s trend stops for a few weeks at some point. Water, a burn that has slowed, a week that ran over: Progress shows which one it looks like for you.',
      href: '/progress', cta: 'See why',
    };
  }
  return null;
}
