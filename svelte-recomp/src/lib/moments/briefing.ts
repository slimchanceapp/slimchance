// THE MORNING BRIEFING: what the phone says the first time it's picked up.
//
// Not an alarm. Android posts it the first time the phone is unlocked after
// the user's morning time (MorningReceiver.java), so it is there when they are,
// and on a morning the phone stays in a drawer it says nothing. The text is
// written here, whenever the app is open, for today and tomorrow: food and
// plans only change through the app, and a forecast made the evening before is
// good enough to dress by.
//
// The watch mirrors the phone, and a watch shows a title and one line: the
// title carries the weather, the first line the first job of the day.
// Pure; see selfcheck.js.

import { CUES, sportOf, type Plans, type PlanCue } from './plans.ts';

export interface DayForecast {
  date: string;
  tMin: number;
  tMax: number;
  /** WMO code for the day: its worst weather. */
  code: number;
  /** Highest chance of rain 06:00–21:59, %; null without hourly data. */
  dayPct: number | null;
  /** First hour 06–21 with a 50 %+ chance; null when the day stays dry. */
  wetFrom: number | null;
}

/** Open-Meteo's /v1/forecast (daily + hourly, timezone=auto) → one entry a day. */
export function parseForecast(json: any): DayForecast[] {
  const d = json?.daily, h = json?.hourly;
  if (!Array.isArray(d?.time)) return [];
  const out: DayForecast[] = [];
  d.time.forEach((date: string, i: number) => {
    const lo = d.temperature_2m_min?.[i], hi = d.temperature_2m_max?.[i], code = d.weather_code?.[i];
    if (typeof lo !== 'number' || typeof hi !== 'number' || typeof code !== 'number') return;
    let dayPct: number | null = null, wetFrom: number | null = null;
    (h?.time ?? []).forEach((t: string, j: number) => {
      const hour = +t.slice(11, 13);
      const p = h.precipitation_probability?.[j];
      if (!t.startsWith(date) || hour < 6 || hour > 21 || typeof p !== 'number') return;
      dayPct = Math.max(dayPct ?? 0, p);
      if (p >= 50 && wetFrom == null) wetFrom = hour;
    });
    out.push({ date, tMin: Math.round(lo), tMax: Math.round(hi), code, dayPct, wetFrom });
  });
  return out;
}

const SNOW = [71, 73, 75, 77, 85, 86];
const STORM = [95, 96, 99];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** "rain from 14:00", "sun and cloud". The daytime odds outrank the day's
 *  code: a drizzle code at 2 % is a dry day. */
export function weatherWords(f: DayForecast): string {
  const what = STORM.includes(f.code) ? 'storms' : SNOW.includes(f.code) ? 'snow' : 'rain';
  if (f.wetFrom != null) return `${what} from ${hh(f.wetFrom)}`;
  const p = f.dayPct ?? 0;
  if (p >= 30) return `${p}% chance of ${what}`;
  if (f.code <= 1) return 'clear';
  if (f.code === 2) return 'sun and cloud';
  if (f.code === 3) return 'cloudy';
  if (f.code === 45 || f.code === 48) return 'fog';
  return 'dry';
}

const deg = (n: number) => (n < 0 ? `−${-n}` : String(n));
export function temps(f: DayForecast): string {
  return f.tMin < 0 ? `${deg(f.tMin)}° to ${deg(f.tMax)}°` : `${f.tMin}–${f.tMax}°`;
}

export interface BriefingInput {
  /** The morning it's for, YYYY-MM-DD. */
  date: string;
  forecast: DayForecast | null;
  /** That weekday's row of the training schedule. */
  day: { label?: string | null; note?: string | null; time?: string | null } | null;
  /** The gym session on it. */
  session: { name: string } | null;
  plans: Plans | null;
  /** The day's share of the week's food (body.week / body.tomorrow). */
  week: { share: number; budget: number; before: number; daysLeft: number } | null;
  /** The breakfast eaten most mornings (quickAdd.usualBreakfast): what the
   *  notification's "Log usual breakfast" button logs. */
  usual?: { names: string[]; kcal: number } | null;
  /** On the 1st: the month whose letter is waiting on Today. */
  letter?: string | null;
}

export interface Briefing { date: string; title: string; body: string }

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTIVE = /badminton|cardio|agility|walk|run|swim|sport|tennis|cycl/i;
const kcal = (n: number) => Math.round(n).toLocaleString('en-US');

export function composeBriefing(i: BriefingInput): Briefing {
  const dow = new Date(`${i.date}T12:00:00`).getDay();
  const hay = `${i.day?.label ?? ''} ${i.day?.note ?? ''}`;
  const time = i.day?.time ? i.day.time.slice(0, 5) : '';
  const sport = sportOf(i.day);
  const playing = !!sport;

  const what = i.session ? i.session.name
    : sport ? sport
    : ACTIVE.test(hay) ? (i.day?.label || 'Active day')
    : 'Rest day';
  const rest = !i.session && what === 'Rest day';

  const lines = ['Scale first, before food or drink.'];
  lines.push(rest ? 'Rest day.' : `${time ? `${time} ` : ''}${what}.`);

  const w = i.week;
  if (w && w.share > 0) {
    lines.push(w.daysLeft === 7 && w.before === 0 ? `New week: ${kcal(w.share)} a day.`
      : w.daysLeft === 1 ? `Food: ${kcal(w.share)} today, the week's last day.`
      : `Food: ${kcal(w.share)} today, ${kcal(w.budget - w.before)} for the ${w.daysLeft} days left.`);
  }

  if (i.usual?.names.length) {
    const names = i.usual.names.length > 3 ? [...i.usual.names.slice(0, 3), '…'] : i.usual.names;
    lines.push(`Usual breakfast: ${names.join(', ')} · ${kcal(i.usual.kcal)} kcal`);
  }

  if (i.letter) lines.push(`${i.letter}, looking back, is on Today.`);

  // The day's own plan: Friday's is the one that decides the weekend, so it
  // wins on a sport Friday.
  const cue = ([dow === 5 ? 'friday' : null, playing ? 'badminton' : null, dow === 6 || dow === 0 ? 'weekend' : null] as Array<PlanCue | null>)
    .find((c): c is PlanCue => c != null && !!i.plans?.[c]?.trim());
  if (cue) lines.push(`${CUES.find((c) => c.cue === cue)!.label}: ${i.plans![cue]!.trim()}`);

  const title = i.forecast
    ? `${DAY[dow]} · ${temps(i.forecast)} · ${weatherWords(i.forecast)}`
    : `${DAY[dow]} · ${what}`;
  return { date: i.date, title, body: lines.join('\n') };
}
