// One night of sleep, from however many sessions the watch split it into.
//
// Waking at 3 a.m. and falling asleep again an hour later gives two Health
// Connect sessions for one night. Taking the longest session (the old rule,
// there to keep naps out of last night) kept 4.3 of 6.5 hours on 29 Oct 2026.
// So sessions from one source with less than NIGHT_GAP_MIN between them are one
// night, attributed to the day it ends; a nap hours away from the night stays
// its own, and the caller still keeps a day's longest night.
//
// A night's sleep is the time asleep in all its pieces together, each moment
// once: pieces that overlap are neither added twice nor dropped (the old rule
// kept only the bigger of two overlapping pieces). 9 and 11 Nov 2026 read 4.1
// and 5.0 hours for full nights the owner slept in pieces.

// The gap, from people rather than one person (scripts/eval-sleep-gaps.mjs, the
// Fitbit study: 24 people, 459 sleep logs, 30 days): the wakes over two hours
// that sat inside a night, or before going back to bed in the morning, ran 2.0
// to 2.6 hours, and the next gaps up (3.1, 3.3 h) were midday naps. Two hours
// split those nights (one read 4.2 of 8.3 hours); three keeps them whole and
// the naps out.
// ponytail: a fixed gap; a wake past three hours splits the night again, and a
// nap within three hours of the night joins it.
export const NIGHT_GAP_MIN = 180;

/** A stretch of time, in epoch milliseconds: [start, end). */
export type Span = [number, number];

// Health Connect sleep-stage codes counted as actually asleep
// (2 SLEEPING, 4 LIGHT, 5 DEEP, 6 REM). Awake / out-of-bed / awake-in-bed excluded.
export const ASLEEP_STAGES = new Set([2, 4, 5, 6]);

/** The stretches of a SleepSession spent asleep: its asleep stages when it has
 *  any, else the whole session. */
export function asleepSpans(s: { startTime: string | Date; endTime: string | Date; stages?: any[] }): Span[] {
  const t = (x: string | Date) => new Date(x).getTime();
  const staged: Span[] = (Array.isArray(s.stages) ? s.stages : [])
    .filter((st) => ASLEEP_STAGES.has(Number(st.stage)))
    .map((st): Span => [t(st.startTime), t(st.endTime)])
    .filter(([a, b]) => b > a);
  return staged.length ? staged : [[t(s.startTime), t(s.endTime)]];
}

/** Minutes covered by these spans together, each moment once. */
export function spanMinutes(spans: Span[]): number {
  let total = 0, from = 0, to = -Infinity;
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    if (a > to) {
      if (to > from) total += to - from;
      from = a;
      to = b;
    } else to = Math.max(to, b);
  }
  if (to > from) total += to - from;
  return total / 60_000;
}

export interface Night<T> {
  day: string;
  origin: string;
  minutes: number;
  sessions: T[];
}

export function sleepNights<T extends { startTime: string | Date; endTime: string | Date }>(
  sessions: T[],
  o: { originOf: (s: T) => string; spansOf: (s: T) => Span[]; dayOf: (t: string | Date) => string }
): Night<T>[] {
  const byOrigin = new Map<string, T[]>();
  for (const s of sessions) {
    const k = o.originOf(s);
    if (!byOrigin.has(k)) byOrigin.set(k, []);
    byOrigin.get(k)!.push(s);
  }
  const nights: Night<T>[] = [];
  for (const [origin, list] of byOrigin) {
    list.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    let night: Night<T> | null = null;
    let end = -Infinity;
    for (const s of list) {
      if (!night || +new Date(s.startTime) - end > NIGHT_GAP_MIN * 60_000) {
        night = { day: '', origin, minutes: 0, sessions: [] };
        nights.push(night);
        end = -Infinity;
      }
      night.sessions.push(s);
      end = Math.max(end, +new Date(s.endTime));
      night.day = o.dayOf(new Date(end));
    }
  }
  for (const n of nights) n.minutes = spanMinutes(n.sessions.flatMap((s) => o.spansOf(s)));
  return nights;
}
