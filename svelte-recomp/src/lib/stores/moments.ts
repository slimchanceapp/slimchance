// The app's two daily notifications, built from the same stores every screen
// reads: the morning briefing (src/lib/briefing.ts) and the evening hold
// (src/lib/hold.ts), each for today and tomorrow. The app shell hands them to
// the phone (+layout.svelte): Android posts each at the first unlock inside its
// window, the iPhone leaves it silently on the lock screen as the window opens.
// The Alarms card shows them, so what arrives is never a surprise.
import { derived, get, writable, type Readable } from 'svelte/store';
import { body } from './body';
import { liveDailyLogs, liveFoodLogs, liveOwnSessions, liveProfile, liveSchedule, liveWeights } from './live';
import { upsertRecord } from './sync';
import { userId } from './user';
import { composeBriefing, type Briefing, type DayForecast } from '$lib/briefing';
import { composeHold, holdAfter, HOLD_UNTIL } from '$lib/hold';
import { badmintonRule, overlaySessions, programWeek } from '$lib/program';
import { WEEKS } from '$lib/data/backRebuild';
import { cleanPlans, sportOf } from '$lib/plans';
import { usualBreakfast, type QuickFood } from '$lib/nutrition';
import { shiftYmd } from '$lib/date';
import { lastMonth, monthLetter } from '$lib/journal';
import { forecastHere } from '$lib/weather';
import { OFF_TREND_KG } from '$lib/body';
import { toUnit, weightUnit, type WeightUnit } from '$lib/units';
import { eveningFrom } from '$lib/brain';
import { brainToday } from './brain';

/** user_settings.briefing: the morning switch and time, and the evening's. */
export interface MomentSetting { on: boolean; after: string; hold: boolean }

export const momentSetting: Readable<MomentSetting | null> = derived(liveProfile(), ($p) => {
  const b = ($p as any)?.briefing;
  if (!b || typeof b !== 'object') return null;
  return { on: !!b.on, after: typeof b.after === 'string' && /^\d\d:\d\d$/.test(b.after) ? b.after : '06:00', hold: !!b.hold };
});

export const forecast = writable<DayForecast[] | null>(null);

/** The forecast here, reused while under an hour old. Set only on a change:
 *  a fresh copy of the same forecast would rebuild everything for nothing. */
export async function refreshForecast(ask = false): Promise<void> {
  const f = await forecastHere(ask);
  if (f && JSON.stringify(f) !== JSON.stringify(get(forecast))) forecast.set(f);
}

/** What the morning briefing's buttons do: weigh in, rate the back while a
 *  program runs, log the usual breakfast when there is one. */
export interface MomentActions {
  weigh: boolean; back: boolean; meal: { label: string; kcal: number; items: QuickFood[] } | null;
  /** The weights the app saves without asking (trend ± OFF_TREND_KG); the
   *  phone asks before taking one outside it, as the app does. */
  weighRange: [number, number] | null;
  /** The unit the person types in (kg, lb, or st typed as pounds), in which
   *  weighRange is also given. Builds before 13 ignore it and say kg. */
  unit: WeightUnit;
}

/** The morning briefing written for today and tomorrow, with its buttons. */
export const briefings: Readable<Array<Briefing & { actions: MomentActions }>> = derived(
  [body, liveSchedule(), liveOwnSessions(), liveProfile(), forecast, liveFoodLogs(), liveDailyLogs(), liveWeights()],
  ([$body, $schedule, $sessions, $profile, $forecast, $food, $daily, $weights]) => {
    const sched = ($schedule as any[]) ?? [];
    const program = ($profile as any)?.program;
    const plans = cleanPlans(($profile as any)?.plans);
    return [$body.today, shiftYmd(1, new Date(`${$body.today}T12:00:00`))].map((date, i) => {
      const day = sched.find((s) => s.day_of_week === new Date(`${date}T12:00:00`).getDay()) ?? null;
      // That day's session, program and all: what Today will show then.
      const session = day?.session_key ? overlaySessions($sessions, sched, program, date).get(day.session_key) ?? null : null;
      const week = programWeek(program, date);
      const rateBack = week >= 1 && week <= WEEKS;
      const usual = usualBreakfast($food as any[], date);
      // The 1st: point at the letter from the month just gone, if it has one.
      const letter = date.endsWith('-01')
        ? monthLetter(lastMonth(date), $daily as any[], ($weights as any[]).map((w) => ({ date: w.date, weight: +w.weight })))?.label ?? null
        : null;
      return {
        ...composeBriefing({
          date, forecast: $forecast?.find((f) => f.date === date) ?? null,
          day, session, rateBack, plans,
          week: i === 0 ? $body.week : $body.tomorrow,
          usual: usual ? { names: usual.items.map((x) => x.name), kcal: usual.kcal } : null,
          letter,
          badmintonRule: badmintonRule(program, date),
        }),
        actions: {
          weigh: true, back: rateBack, meal: usual ? { label: 'Usual breakfast', kcal: usual.kcal, items: usual.items } : null,
          // In the person's own unit: the phone compares what they type with it.
          weighRange: $body.currentKg != null
            ? [Math.round(toUnit($body.currentKg - OFF_TREND_KG) * 10) / 10, Math.round(toUnit($body.currentKg + OFF_TREND_KG) * 10) / 10] as [number, number] : null,
          unit: weightUnit(),
        },
      };
    });
  },
);

/** The evening hold written for today and tomorrow. Only today's knows the
 *  food; tomorrow's is rewritten tomorrow, whenever the app is next open.
 *  Today's is the coach brain's when it wrote one (stores/brain), and null
 *  when it chose silence: it replaces this one message, never adds one. */
export const holds: Readable<Array<Briefing | null>> = derived(
  [body, liveSchedule(), liveProfile(), brainToday],
  ([$body, $schedule, $profile, $brain]) => {
    const sched = ($schedule as any[]) ?? [];
    const plans = cleanPlans(($profile as any)?.plans);
    return [$body.today, shiftYmd(1, new Date(`${$body.today}T12:00:00`))].map((date, i) => {
      const day = sched.find((s) => s.day_of_week === new Date(`${date}T12:00:00`).getDay());
      const hold = composeHold({
        date, plans, why: ($profile as any)?.why ?? null,
        // A night the program says no games isn't a sport night.
        sportDay: !!sportOf(day) && !(sportOf(day) === 'Badminton' && badmintonRule(($profile as any)?.program, date)?.play === false),
        food: i === 0 ? {
          kcal: $body.intake.get(date)?.kcal ?? 0, share: $body.week?.share ?? null,
          proteinG: $body.intake.get(date)?.protein ?? 0, proteinTargetG: $body.proteinTargetG,
        } : null,
      });
      return i === 0 ? eveningFrom(hold, $brain) : hold;
    });
  },
);

/** The morning briefing's window ends with the day: the first unlock after its
 *  time brings it, whatever the hour (the owner, 2026-11-11, after a late night
 *  when it closed at noon: "any time I unlock my phone after 6am"). */
export const MORNING_UNTIL = 24 * 60;

export interface Moment { date: string; key: 'morning' | 'evening'; after: number; until: number; title: string; body: string; actions?: MomentActions }

/** Everything Android should hold, with each one's window. */
export const moments: Readable<Moment[]> = derived([momentSetting, briefings, holds], ([$s, $b, $h]) => {
  if (!$s) return [];
  const out: Moment[] = [];
  if ($s.on) for (const b of $b) out.push({ ...b, key: 'morning', after: minutesOf($s.after), until: MORNING_UNTIL });
  if ($s.hold) for (const h of $h) if (h) out.push({ ...h, key: 'evening', after: holdAfter(new Date(`${h.date}T12:00:00`).getDay()), until: HOLD_UNTIL });
  return out;
});

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export async function saveMoments(s: MomentSetting): Promise<void> {
  const uid = get(userId);
  if (!uid) throw new Error('Not signed in — sign back in.');
  await upsertRecord('user_settings', { user_id: uid, briefing: { on: s.on, after: s.after, hold: s.hold }, updated_at: new Date().toISOString() });
}
