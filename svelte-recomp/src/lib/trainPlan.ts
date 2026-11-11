// The coach arranges the rest of the training week (pact m14, 2026-11-10:
// "which of your own sessions go on which day, walks and rest, from your Train
// week and the watch. Never new exercises or loads"). The AI proposes; this
// decides whether the proposal may be shown. Pure; checked in selfcheck.js.

export interface TrainDay { date: string; kind: 'session' | 'walk' | 'rest'; session: string | null; minutes: number | null; why: string }
export interface CheckedTrainPlan { ok: boolean; why: string | null; days: TrainDay[]; note: string }

/** Sessions still to do this week: the plan's count, less what's done. */
export const sessionsLeft = (weekly: number, done: number): number => Math.max(0, weekly - done);

/** Words without numbers: a number in the coach's words was never checked. */
const plain = (s: unknown, max: number) => { const t = String(s ?? '').trim(); return /\d/.test(t) ? '' : t.slice(0, max); };

export function checkTrainPlan(
  reply: { days?: unknown; note?: unknown } | null | undefined,
  f: { days: string[]; sessions: string[]; left: number; easyToday: boolean; today: string },
): CheckedTrainPlan {
  const fail = (why: string): CheckedTrainPlan => ({ ok: false, why, days: [], note: '' });
  if (!reply || !Array.isArray(reply.days)) return fail('no plan in the answer');
  const own = new Map(f.sessions.map((s) => [s.trim().toLowerCase(), s]));
  const days: TrainDay[] = [];
  for (const date of f.days) {
    const d = (reply.days as any[]).find((x) => x?.date === date);
    if (!d) return fail(`nothing for ${date}`);
    const kind = d.kind;
    if (kind !== 'session' && kind !== 'walk' && kind !== 'rest') return fail(`"${String(kind)}" on ${date} is not a session, a walk or rest`);
    let session: string | null = null, minutes: number | null = null;
    if (kind === 'session') {
      session = own.get(String(d.session ?? '').trim().toLowerCase()) ?? null;
      if (!session) return fail(`"${String(d.session ?? '')}" isn't one of their sessions: never a new one`);
      if (f.easyToday && date === f.today) return fail('today their body asks for an easy day: a walk or rest');
    }
    if (kind === 'walk') {
      minutes = Math.round(Number(d.minutes));
      if (!(minutes >= 15 && minutes <= 60)) return fail(`a walk of ${String(d.minutes)} minutes on ${date}: 15 to 60`);
    }
    days.push({ date, kind, session, minutes, why: plain(d.why, 90) });
  }
  const planned = days.filter((d) => d.kind === 'session');
  if (planned.length > f.left) return fail(`${planned.length} sessions, but only ${f.left} are left this week`);
  // Spread out wherever the days allow it: k sessions fit apart in n days when k <= ceil(n/2).
  const apart = planned.length <= Math.ceil(days.length / 2);
  for (let i = 1; i < days.length && apart; i++) {
    if (days[i].kind === 'session' && days[i - 1].kind === 'session') return fail(`sessions back to back on ${days[i - 1].date} and ${days[i].date}`);
  }
  return { ok: true, why: null, days, note: plain(reply.note, 300) };
}

/** The Train hero's colour. Orange means "look here", so it waits until a
 *  planned training day has passed without one: "0 of 2" on a Monday morning
 *  is the plan, not a miss (2026-11-10). Never red. `plannedDows` are the
 *  plan's training days, 0 = Sunday as in Date.getDay(). */
export function trainingTone(done: number, target: number, plannedDows: number[], todayDow: number): 'good' | 'ok' | 'warn' {
  if (done >= target) return 'good';
  const mon = (d: number) => (d + 6) % 7; // Monday 0 .. Sunday 6
  const due = plannedDows.filter((d) => mon(d) < mon(todayDow)).length;
  return done >= due ? 'ok' : 'warn';
}
