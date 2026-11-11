// Weekly training templates.
//
// WHY: the app seeded every new user with one specific person's week — including
// "🏸 Badminton — NTC, 7:00–9:00 PM" on Wednesdays and Fridays. The SESSIONS
// themselves (lower / upper / full body in workoutPlanDefaults) are perfectly
// generic and stay as they are; it was only the weekly SHAPE that was personal.
//
// So this generates the shape instead of hardcoding it: pick how many days you
// lift, optionally name a sport and the nights you play it, and the lifting days
// are arranged around it. That arrangement is the actual expertise here — a
// heavy squat session the day before a court night means playing on dead legs,
// and doing it the day after means squatting on legs that are already trashed.
//
// Pure and unit-tested — no Svelte or Dexie.

import type { PlanDay } from './workoutPlanDefaults';

export interface PlanTemplate {
  id: string;
  name: string;
  /** One line the user can actually judge the choice by. */
  blurb: string;
  /** How many gym sessions a week this produces. */
  liftDays: number;
  /** True when this template expects a sport/cardio commitment. */
  usesSport: boolean;
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'gym3',
    name: 'Gym 3× a week',
    blurb: 'Lower, upper, full body on alternating days. Enough to hold on to muscle while you lose fat, with rest days to recover.',
    liftDays: 3,
    usesSport: false
  },
  {
    id: 'gym4',
    name: 'Gym 4× a week',
    blurb: 'Two lower and two upper days. More volume if you already train consistently and recover well.',
    liftDays: 4,
    usesSport: false
  },
  {
    id: 'gym2',
    name: 'Gym 2× a week',
    blurb: 'Two full-body sessions. Realistic when time is tight — and twice a week is enough to keep muscle while dieting.',
    liftDays: 2,
    usesSport: false
  },
  {
    id: 'gym-sport',
    name: 'Gym + a sport',
    blurb: 'Lifting arranged around your sport nights, so you never squat heavy the day before you play — or the day after.',
    liftDays: 3,
    usesSport: true
  },
  {
    id: 'walk',
    name: 'No gym for now',
    blurb: 'A walk a day, any pace. Plenty of people lose weight and keep it off without ever lifting; you can add the gym later.',
    liftDays: 0,
    usesSport: false
  }
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface BuildScheduleOpts {
  templateId: string;
  /** What the user calls their sport, e.g. "Badminton". Only for sport templates. */
  sportName?: string;
  /** Days of week (0=Sun) the sport happens. */
  sportDays?: number[];
  /** Free text, e.g. "7:00–9:00 PM at the club". */
  sportTime?: string;
}

function restDay(dow: number): PlanDay {
  return { day_of_week: dow, label: 'Rest', session_key: null, note: 'Full rest day' };
}

/**
 * Pick lifting days that avoid sitting immediately either side of a sport day.
 *
 * Sport nights already load the legs hard, so a heavy lower session the day
 * before means playing fatigued and the day after means lifting on legs that
 * haven't recovered. We score every candidate day by its distance from the
 * nearest sport day and take the furthest ones, which reproduces the sensible
 * Mon/Thu/Sat shape for Wed+Fri sport without hardcoding it.
 */
function spreadLiftDays(sportDays: number[], count: number): number[] {
  if (count <= 0) return [];
  const candidates = [1, 2, 3, 4, 5, 6, 0]; // Mon-first ordering
  if (sportDays.length === 0) {
    // No sport: spread evenly across the week starting Monday.
    const spread: Record<number, number[]> = {
      2: [1, 4],
      3: [1, 3, 5],
      4: [1, 2, 4, 5]
    };
    return spread[count] ?? [1, 3, 5];
  }
  const distance = (d: number) =>
    Math.min(...sportDays.map((s) => {
      const raw = Math.abs(d - s);
      return Math.min(raw, 7 - raw); // the week wraps
    }));

  return candidates
    .filter((d) => !sportDays.includes(d))
    .sort((a, b) => distance(b) - distance(a) || a - b)
    .slice(0, count)
    .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));
}

/** Which session key each lifting slot gets, cycling through the available split. */
function sessionForSlot(templateId: string, index: number): string {
  if (templateId === 'gym2') return 'fullbody';
  if (templateId === 'gym4') return ['lower', 'upper', 'lower', 'upper'][index % 4];
  return ['lower', 'upper', 'fullbody'][index % 3];
}

function labelFor(key: string): string {
  switch (key) {
    case 'lower': return 'Heavy Lower Body';
    case 'upper': return 'Heavy Upper Body';
    default: return 'Full Body';
  }
}

/**
 * Build a full 7-day schedule from a template. Always returns exactly 7 days,
 * Sunday..Saturday, so it can seed workout_schedule directly.
 */
export function buildSchedule(opts: BuildScheduleOpts): PlanDay[] {
  const template = PLAN_TEMPLATES.find((t) => t.id === opts.templateId) ?? PLAN_TEMPLATES[0];
  const sportDays = template.usesSport ? [...new Set(opts.sportDays ?? [])].sort() : [];
  const sportName = (opts.sportName || '').trim() || 'Sport';
  const sportTime = (opts.sportTime || '').trim();

  const liftDays = spreadLiftDays(sportDays, template.liftDays);

  const days: PlanDay[] = [];
  for (let dow = 0; dow < 7; dow++) {
    if (sportDays.includes(dow)) {
      days.push({
        day_of_week: dow,
        label: 'Cardio & Agility',
        session_key: null,
        // Framing this as real training rather than a rest day is the whole
        // point. Deliberately says nothing about a deficit: someone who is
        // GAINING is a legitimate recomp user and this is seeded for everyone.
        note: `${sportName}${sportTime ? ` — ${sportTime}` : ''} — this counts as training`
      });
      continue;
    }
    const slot = liftDays.indexOf(dow);
    if (slot >= 0) {
      const key = sessionForSlot(template.id, slot);
      days.push({
        day_of_week: dow,
        label: labelFor(key),
        session_key: key,
        note: sportDays.length
          ? 'Placed away from your sport nights so neither session is done on tired legs'
          : ''
      });
      continue;
    }
    days.push(template.id === 'walk'
      ? { day_of_week: dow, label: 'Walk', session_key: null, note: 'A walk counts: 30 minutes, any pace' }
      : restDay(dow));
  }

  // Guarantee at least one genuine rest day — recovery is when the adaptation
  // actually happens, and a 7-day-a-week plan in a deficit is how people get hurt.
  if (!days.some((d) => d.session_key === null && !sportDays.includes(d.day_of_week))) {
    days[0] = restDay(0);
  }

  return days;
}

/** Human summary of a schedule, for confirming the choice before saving. */
export function describeSchedule(days: PlanDay[]): string {
  if (days.length && days.every((d) => d.label === 'Walk')) return 'A walk every day, no gym';
  const lifts = days.filter((d) => d.session_key).map((d) => DAY_NAMES[d.day_of_week].slice(0, 3));
  const sport = days
    .filter((d) => !d.session_key && d.label === 'Cardio & Agility')
    .map((d) => DAY_NAMES[d.day_of_week].slice(0, 3));
  const parts = [`Gym: ${lifts.join(', ') || 'none'}`];
  if (sport.length) parts.push(`Sport: ${sport.join(', ')}`);
  const rest = 7 - lifts.length - sport.length;
  parts.push(`${rest} rest day${rest === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
