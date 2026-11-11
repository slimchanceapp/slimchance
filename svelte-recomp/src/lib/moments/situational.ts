// ALARMS THAT KNOW SOMETHING.
//
// "18:00 — Weigh-in" is a clock. "You're 40 g of protein short and it's 8pm" is
// a coach. The app already computes everything needed for the second kind — it
// just had no way to say it at the moment it would matter, because a phone in a
// pocket runs none of this code.
//
// The trick is that state in this app ONLY changes through the app: food, sets
// and weight are all typed in. So evaluating the day whenever the app is open,
// and (re)scheduling one-shot OS notifications for later today, is enough — by
// the time a nudge fires, nothing can have silently invalidated it except the
// user opening the app again, which re-evaluates and cancels it.
//
// Pure and unit-tested. The OS half lives in nativeAlarms.ts.
//
// No streak alarms. "Your 9-day streak is at risk" is loss aversion aimed
// at the user, and a broken streak is exactly the "the diet's ruined anyway"
// moment that turns one missed day into a lost week. What fires instead, when
// the user has written one, is their OWN plan at its moment: Friday evening,
// the weekend, a sport night.

import { CUES, type Plans, type PlanCue } from './plans.ts';

export type NudgeKey = 'protein-short' | 'train-day' | 'plan' | 'weigh-in';

export interface Nudge {
  key: NudgeKey;
  /** Minutes from midnight — the time today this should fire. */
  atMinutes: number;
  title: string;
  body: string;
  /** Higher wins when trimming to the daily cap. */
  priority: number;
}

export interface SituationInput {
  /** Minutes from midnight, right now. Nudges in the past are never scheduled. */
  nowMinutes: number;
  proteinG: number;
  proteinTargetG: number | null;
  kcal: number;
  kcalTargetKcal: number | null;
  foodEntriesToday: number;
  /** Is today a scheduled training day, and has a set been logged today? */
  isTrainingDay: boolean;
  workoutLoggedToday: boolean;
  /** Their training reaches the app from a watch, through Health Connect, which
   *  the app reads only while it's open: a reminder armed now can't know they
   *  trained after. */
  watchTrains?: boolean;
  /** Today's scheduled session, so its reminder comes at its own time and says
   *  what it is. Without it, the old 17:30 one. */
  session?: { label: string; time: string; sport: string | null; note?: string | null } | null;
  /** The user's plans, today's weekday (0 = Sunday) and whether it's a
   *  sport day — what decides which plan's moment is coming. */
  plans?: Plans | null;
  dow?: number;
  sportDay?: boolean;
  /** Days since the last weigh-in; null when there has never been one. */
  daysSinceWeighIn: number | null;
  /** The morning briefing is on: it already says "scale first" and carries
   *  the weekend's plan, so neither gets a ping of its own. */
  briefing?: boolean;
  /** The evening hold is on: it carries the evening's plan (Friday's,
   *  the sport's, the weekend's) and what's left of the day's protein. */
  hold?: boolean;
}

/**
 * At most this many nudges a day. Notification fatigue is the fastest way to
 * teach someone to swipe the app away permanently — three "helpful" pings a day
 * is how a coach becomes a nag.
 */
export const MAX_NUDGES_PER_DAY = 2;

// No "nothing logged yet" nudge: an empty log at 14:00 is a fast as often as
// a gap, and the clock can't tell which. Someone eating 15:00–22:00 by design
// got told off every day.
const T = {
  trainDay: 17 * 60 + 30, // 17:30 — before the evening is spoken for
  proteinShort: 19 * 60,  // 19:00 — one meal left to fix it, not a post-mortem
  weighIn: 7 * 60 + 30,   // tomorrow morning, when a weigh-in is actually possible
};

/**
 * The nudges worth firing for the rest of today, best first, capped.
 *
 * Every one of these is a statement about a fact the app can prove right now.
 * Nothing speculative, nothing motivational-poster: if there is no shortfall,
 * there is no notification, and the day passes in silence. Silence is the
 * feature that makes the other days' messages worth reading.
 */
export function situationalNudges(input: SituationInput): Nudge[] {
  const out: Nudge[] = [];
  const {
    nowMinutes, proteinG, proteinTargetG, foodEntriesToday, isTrainingDay,
    workoutLoggedToday, daysSinceWeighIn,
  } = input;

  // Protein short with time left to do something about it.
  if (proteinTargetG != null && proteinTargetG > 0 && foodEntriesToday > 0 && !input.hold) {
    const short = proteinTargetG - proteinG;
    const pct = proteinG / proteinTargetG;
    if (short >= 20 && pct < 0.85) {
      out.push({
        key: 'protein-short', atMinutes: T.proteinShort, priority: 90,
        title: `${Math.round(short)}g of protein to go`,
        body: `You're on ${Math.round(proteinG)}g of ${proteinTargetG}g. One protein-forward meal closes it — in a deficit this is what decides whether the scale drop is fat or muscle.`,
      });
    }
  }

  // Scheduled training day, still untrained (a session marked done, sets, or
  // the watch all count). It replaced the old weekly alarms, which fired at a
  // fixed time whatever had happened.
  // ponytail: no session-time reminder for a watch wearer, whose workout may
  // already be on the watch when it fires (2026-10-26 and 28: "still on?" after
  // the gym). The morning briefing names the day's session. Bring it back once
  // the phone checks Health Connect itself before posting (native).
  if (isTrainingDay && !workoutLoggedToday && !input.watchTrains) {
    const s = input.session;
    const at = s ? sessionReminderAt(s) : T.trainDay;
    if (s && at != null && !(s.sport && input.sportDay === false)) {
      out.push({
        key: 'train-day', atMinutes: at, priority: 80,
        title: s.sport ? `${s.sport} ${at >= 17 * 60 ? 'tonight' : 'today'}` : `${s.label} at ${s.time}`,
        body: s.note?.trim() || (s.sport ? 'Time to head out.' : LIFT),
      });
    } else if (!s) {
      out.push({ key: 'train-day', atMinutes: T.trainDay, priority: 80, title: 'Training day — still on?', body: LIFT });
    }
  }

  // The user's own plan, just before its moment: decided days ago, so all it
  // needs now is recognising the moment.
  const plan = planMoment(input);
  if (plan) out.push(plan);

  // No weigh-in for days: fires tomorrow morning, when one is actually possible.
  if (daysSinceWeighIn != null && daysSinceWeighIn >= 3 && !input.briefing) {
    out.push({
      key: 'weigh-in', atMinutes: T.weighIn, priority: 50,
      title: `${daysSinceWeighIn} days since your last weigh-in`,
      body: 'Weigh in first thing, before food or drink. Single readings lie; the trend needs dots to draw a line through.',
    });
  }

  return out
    // A morning nudge (weigh-in) is for TOMORROW morning, so it is never "past".
    .filter((n) => n.key === 'weigh-in' || n.atMinutes > nowMinutes)
    .sort((a, b) => b.priority - a.priority || a.atMinutes - b.atMinutes)
    .slice(0, MAX_NUDGES_PER_DAY);
}

const LIFT = 'Lifting is the signal that tells your body to keep muscle while your weight moves. Even a short heavy session counts.';

/** A sport's time is already when to leave; a gym time is when it starts, so
 *  45 minutes before. Before 08:00 it's the morning briefing's to mention. */
function sessionReminderAt(s: { time: string; sport: string | null }): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.time.trim());
  if (!m) return null;
  const at = +m[1] * 60 + +m[2] - (s.sport ? 0 : 45);
  return at >= 8 * 60 ? at : null;
}

/** When each plan is worth a ping: before the moment, not in the middle of it. */
const PLAN_AT: Partial<Record<PlanCue, number>> = {
  badminton: 17 * 60,     // before leaving for the hall
  friday: 16 * 60 + 30,   // before leaving work
  weekend: 10 * 60 + 30,  // late morning, before the day fills
};

function planMoment(i: SituationInput): Nudge | null {
  if (!i.plans || i.dow == null || i.hold) return null;
  const cue: PlanCue | null = i.sportDay ? 'badminton' : i.dow === 5 ? 'friday' : i.dow === 6 || i.dow === 0 ? 'weekend' : null;
  // A sport Friday with no after-sport plan still gets the Friday one.
  const candidates: Array<PlanCue | null> = [cue, i.dow === 5 ? 'friday' : null];
  const pick = candidates.find((c): c is PlanCue => c != null && !!i.plans?.[c]?.trim());
  if (!pick || (pick === 'weekend' && i.briefing)) return null;
  const info = CUES.find((c) => c.cue === pick)!;
  return { key: 'plan', atMinutes: PLAN_AT[pick]!, priority: 75, title: `${info.label}: your plan`, body: i.plans[pick]!.trim() };
}

/** Minutes-from-midnight for a Date, in local time. */
export function minutesOfDay(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** The absolute Date a nudge should fire — today, or tomorrow for the morning one. */
export function nudgeFireAt(n: Nudge, now: Date = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(Math.floor(n.atMinutes / 60), n.atMinutes % 60);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}
