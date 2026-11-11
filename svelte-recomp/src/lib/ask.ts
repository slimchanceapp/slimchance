// The app's check on an answer from "Ask about your numbers"
// (supabase/functions/ask): the AI proposes, this decides whether a word of it
// is shown. Every number must come from the person's facts or a tool result,
// nothing from the coach's never-say list, and a source only if it was
// retrieved for this question. Pure; checked in selfcheck.js.

import { numbersIn, NEVER } from './brain.ts';

export interface AskSource { id: string; title: string; url: string }
export interface AskReply { answer: string; sources: string[]; calls: Array<{ name: string; result: unknown }>; passages: AskSource[] }
export type AskChecked = { ok: true; answer: string; sources: AskSource[] } | { ok: false; why: string };

/** Small whole counts (days, mornings, sessions) a reader can see in their
 *  own week. A small decimal ("down 2.7 kg") is a measurement: it must be found. */
const FREE_UNDER = 14;

/** Medicine is mentioned only to send someone to their doctor, and never with
 *  a go-ahead to stop or change anything. The coach's flat rule refused even
 *  "talk to your doctor about your medication" (eval-ask, 2026-11-11). */
const MEDICINE = /\b(medications?|medicines?|pills?|tablets?|doses?|dosage|prescri\w*|diagnos\w*)\b/i;
const DOCTOR = /\b(your doctor|your GP|your prescriber|your pharmacist|a doctor)\b/i;
const GO_AHEAD = /\b(you can|you could|you should|it'?s safe to|it is safe to|it'?s fine to|it is fine to|feel free to)\b[^.]{0,40}\b(stop|reduce|lower|cut|skip|change|increase|come off)\b/i;

export function checkAnswer(r: AskReply | null | undefined, facts: unknown): AskChecked {
  const answer = String(r?.answer ?? '').trim();
  if (!answer) return { ok: false, why: 'no answer' };
  if (answer.length > 700) return { ok: false, why: 'too long' };
  for (const [what, rx] of NEVER) {
    if (what === 'medical advice') continue; // MEDICINE below, which allows a referral
    // "If you start logging the oil, the number adjusts" is our own guide, not a
    // request: a clause that opens with "if you" is left out of the logging rule.
    const bad = rx.exec(what === 'asking for more logging' ? answer.replace(/\bif you\b[^,.\n]{0,40},/gi, '') : answer);
    if (bad) return { ok: false, why: `${what}: "${bad[0].trim()}"` };
  }
  if (MEDICINE.test(answer) && (!DOCTOR.test(answer) || GO_AHEAD.test(answer)))
    return { ok: false, why: 'medical advice: medicine is for their doctor, with no go-ahead to change it' };
  const known = numbersIn(JSON.stringify(facts) + JSON.stringify(r?.calls?.map((c) => c.result) ?? []));
  for (const n of numbersIn(answer)) {
    if (Number.isInteger(n) && n <= FREE_UNDER) continue;
    if (!known.some((k) => Math.abs(k - n) <= Math.max(0.1, Math.abs(k) * 0.01))) return { ok: false, why: `${n} isn't in its facts or tools` };
  }
  const offered = new Map((r?.passages ?? []).map((p) => [p.id, p]));
  const sources = [...new Set(r?.sources ?? [])].map((id) => offered.get(id)).filter((p): p is AskSource => !!p);
  return { ok: true, answer, sources };
}
