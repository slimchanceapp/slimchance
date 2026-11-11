// PLANS — "when X happens, I'll do Y", decided in advance.
//
// Willpower at 9 pm on a Friday is the worst time to decide anything. Plans
// made ahead in exactly this shape ("implementation intentions") raise
// follow-through by a medium-to-large effect (d ≈ 0.65 across 94 studies;
// Gollwitzer & Sheeran 2006), because the decision is already made when the
// moment arrives — you only have to recognise it. So the app's job is to hold
// the plan and put it in front of you when its moment comes round: Friday
// evening, the weekend, late at night, home from sport, a bad back
// morning, a trend over the ceiling.
//
// One plan per moment, in the user's own words. Pure; see selfcheck.js.

// 'badminton' is the plan for after any sport: the id stays because plans are
// stored under it (it began as badminton).
export type PlanCue = 'line' | 'badminton' | 'friday' | 'weekend' | 'evening';

export type Plans = Partial<Record<PlanCue, string>>;

export interface CueInfo {
  cue: PlanCue;
  /** "When …" — how the moment reads in the editor. */
  when: string;
  /** Short label for the strip on Today. */
  label: string;
  /** A starting point the user can keep or rewrite. */
  suggestion: string;
}

/** In the order they win when two moments overlap: the specific beats the
 *  general, and the line beats everything. */
export const CUES: CueInfo[] = [
  { cue: 'line', when: 'When my trend goes over my ceiling', label: 'Over your ceiling', suggestion: 'Two weeks: the weekend at my weekday number, and the scale every morning.' },
  { cue: 'badminton', when: 'When I get home from my sport', label: 'After sport', suggestion: 'A shake first, then dinner — never dinner starving.' },
  { cue: 'friday', when: 'When it’s Friday evening', label: 'Friday evening', suggestion: 'Dinner decided before I leave work: one plate, protein first.' },
  { cue: 'weekend', when: 'On the weekend', label: 'Weekend', suggestion: 'Leftovers go in a box for tomorrow, not in me.' },
  { cue: 'evening', when: 'When I’m hungry late at night', label: 'Late evening', suggestion: 'Quark, yoghurt or a shake, then the kitchen’s closed.' },
];

export interface PlanMoment {
  /** Local hour 0..23. */
  hour: number;
  /** 0 = Sunday … 6 = Saturday. */
  dow: number;
  /** Today is a sport day (the schedule says so, or the watch saw one). */
  sportDay: boolean;
  /** The trend is over the ceiling. */
  overLine: boolean;
}

/** The sport a planned day names, else null. The "Gym + a sport" week files
 *  it as "Cardio & Agility" with the sport first in the note ("Football —
 *  7–9 pm — this counts as training"); a week typed by hand may just say
 *  "Badminton". A walk is not one. */
export function sportOf(day: { label?: string | null; note?: string | null } | null | undefined): string | null {
  if (!day) return null;
  if (/badminton/i.test(`${day.label ?? ''} ${day.note ?? ''}`)) return 'Badminton';
  if (!/cardio\s*&\s*agility/i.test(day.label ?? '')) return null;
  const name = (day.note ?? '').split(/\s+[—–-]\s+/)[0].trim();
  return name && !/counts as training/i.test(name) ? name : 'Sport';
}

/** Is this moment the plan's moment right now? */
export function cueActive(cue: PlanCue, m: PlanMoment): boolean {
  switch (cue) {
    case 'line': return m.overLine;
    case 'badminton': return m.sportDay && m.hour >= 17;
    case 'friday': return m.dow === 5 && m.hour >= 15;
    case 'weekend': return m.dow === 6 || m.dow === 0;
    case 'evening': return m.hour >= 20;
  }
}

/** The plan to show right now — the most specific one whose moment it is. */
export function activePlan(plans: Plans | null | undefined, m: PlanMoment): (CueInfo & { then: string }) | null {
  for (const c of CUES) {
    const then = plans?.[c.cue]?.trim();
    if (then && cueActive(c.cue, m)) return { ...c, then };
  }
  return null;
}

/** Plans as stored: only known moments, trimmed, empties dropped, capped. */
export function cleanPlans(input: unknown): Plans {
  const out: Plans = {};
  if (!input || typeof input !== 'object') return out;
  for (const c of CUES) {
    const v = (input as Record<string, unknown>)[c.cue];
    if (typeof v === 'string' && v.trim()) out[c.cue] = v.trim().slice(0, 200);
  }
  return out;
}

/** The plan a weekly review asks about: the one for the moments that decide
 *  most weeks, first. */
export function planToReview(plans: Plans): (CueInfo & { then: string }) | null {
  for (const cue of ['weekend', 'friday', 'badminton', 'evening'] as PlanCue[]) {
    const then = plans[cue]?.trim();
    if (then) return { ...CUES.find((c) => c.cue === cue)!, then };
  }
  return null;
}
