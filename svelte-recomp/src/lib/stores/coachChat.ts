// Talk to your coach (Pact m49): the chat's side of the conversation, on its
// own so only the chat page downloads it (the first screen stays as it was).
import { get } from 'svelte/store';
import { supabase } from '$lib/db/client';
import { checkAnswer, checkActions, type AskSource, type ChatWeek, type CoachAction } from '$lib/coach';
import { body } from '$lib/stores/body';
import { liveProfile, liveWeights } from '$lib/stores/live';
import { toUnit, weightUnit } from '$lib/units';
import { currentFacts, saveCoach } from '$lib/stores/brain';

const notesOf = (p: any): string | null => (p?.coach && typeof p.coach === 'object' ? p.coach.notes ?? null : null);

/** Remember something about them for the coach (a change they accepted in Talk
 *  to your coach): a line added to its notes, the oldest dropping off the
 *  limit the notes have always had. */
export async function rememberForCoach(note: string): Promise<void> {
  const notes = [notesOf(get(liveProfile())), note].filter(Boolean).join('\n');
  await saveCoach({ notes: notes.slice(-900), notes_at: new Date().toISOString() });
}

export type CoachTalk = { ok: true; answer: string; sources: AskSource[]; actions: CoachAction[] } | { ok: false; why: string };

/** Talk to your coach (Pact m49): the conversation so far, with their week in
 *  the facts. Every word passes Ask about your numbers' check, and every change
 *  it proposes is checked against their own week (src/lib/coach/chat.ts). A
 *  reply the app refuses, or a change it can't stand behind, is asked for once
 *  more with the reason. Nothing here saves a change: he taps for that. */
export async function talkToCoach(
  history: { role: 'user' | 'coach'; text: string }[],
  week: ChatWeek & { alarms: string[]; goal: string | null },
  now = new Date(),
): Promise<CoachTalk> {
  const facts = { ...currentFacts(now, []), week };
  const b = get(body);
  const unit = weightUnit() === 'kg' ? 'kg' : 'lb';
  const req = {
    messages: history.slice(-12), today: facts.now.date, facts, unit,
    weights: ((get(liveWeights()) as any[]) ?? []).filter((w) => w.date && +w.weight > 0)
      .map((w) => ({ date: String(w.date), weight: +toUnit(+w.weight).toFixed(2) }))
      .sort((x, y) => x.date.localeCompare(y.date)).slice(-400),
    goal: b.target?.direction === 'gain' ? 'gain' : b.target?.direction === 'maintain' || b.keepSince ? 'hold' : 'lose',
    goal_weight: b.goalKg != null ? +toUnit(b.goalKg).toFixed(1) : null,
  };
  let problem: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke('ask', { body: { ...req, problem }, timeout: 55_000 });
    if (error || !data?.answer) {
      const said = await (error as any)?.context?.json?.().catch(() => null);
      return { ok: false, why: said?.error ?? data?.error ?? 'Couldn’t reach your coach. Try again in a moment.' };
    }
    const checked = checkAnswer(data, facts);
    if (!checked.ok) { console.warn('[coach chat] refused:', checked.why); problem = checked.why; continue; }
    const { actions, dropped } = checkActions(data.actions, week);
    if (dropped.length && attempt === 0) { console.warn('[coach chat] changes refused:', dropped); problem = `changes the app refused: ${dropped.join('; ')}`; continue; }
    return { ok: true, answer: checked.answer, sources: checked.sources, actions };
  }
  return { ok: false, why: 'No answer the app could stand behind this time. Try saying it another way.' };
}
