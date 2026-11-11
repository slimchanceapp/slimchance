// ask — "Ask about your numbers" (book chapter 8). One question, answered by
// the agent in agent.ts from three things: the person's facts (built by the app,
// src/lib/brain.ts buildFacts), the passages of our guides nearest the question
// by meaning (knowledge.ts), and the slim_chance tool, which this function
// calls on the app's own MCP server with the person's real weigh-ins. Nothing
// here computes a number about the person, and nothing is stored. The app
// checks the answer before a word of it is shown (src/lib/ask.ts checkAnswer).
//
// Gemma only, through providersFor: a question about someone's own numbers is
// as personal as the coach's facts.
//
//   POST {"question": "...", "today": "YYYY-MM-DD", "facts": {...},
//         "weights": [{"date": "YYYY-MM-DD", "weight": 94.2}], "unit": "kg"|"lb",
//         "goal": "lose"|"gain"|"hold", "goal_weight": 88 | null, "problem"?: "..."}
//   -> {"answer": "...", "sources": ["passage id"], "calls": [{name, args, result}],
//       "passages": [{id, title, url}]}

import { corsHeaders, embed, gemmaTurn, json } from '../_shared/llm.ts';
import { gate, providersFor } from '../_shared/auth.ts';
import { nearest, type Passage } from '../_shared/knowledge.ts';
import { runAgent, weighInsFor, type Weighed } from './agent.ts';
import kb from '../_shared/knowledge.json' with { type: 'json' };

const KB = kb as { model: string; passages: Passage[] };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MCP = 'https://slimchance.app/mcp';

/** The MCP tool, called the way any agent would: JSON-RPC over HTTP. The
 *  header keeps the app's own calls out of the server's "is anyone using it"
 *  count. ponytail: every edge call leaves from Supabase's few addresses, so the
 *  firewall's per-address limit on /mcp is shared by all askers; a direct
 *  import of the tool if that ever bites. */
async function slimChance(weigh_ins: Weighed[], b: { unit: string; goal: string; goal_weight: number | null }): Promise<unknown> {
  if (!weigh_ins.length) return { error: 'No weigh-ins between those dates.' };
  const r = await fetch(MCP, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', 'X-Slimchance-From': 'ask' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'slim_chance', arguments: { weigh_ins, unit: b.unit, goal: b.goal, ...(b.goal_weight != null ? { goal_weight: b.goal_weight } : {}) } } }),
  });
  const m = await r.json().catch(() => null);
  return m?.result ?? { error: m?.error?.message ?? `The tool answered ${r.status}.` };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const refused = await gate(req, 'ai');
  if (refused) return refused;
  if (!providersFor(req, 'private').includes('gemma')) return json({ error: 'Asking is resting for now.' }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON.' }, 400); }
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 300) return json({ error: 'Ask one question, up to 300 characters.' }, 400);
  const today = typeof body?.today === 'string' && YMD.test(body.today) ? body.today : null;
  const facts = body?.facts;
  if (!today || !facts || typeof facts !== 'object' || JSON.stringify(facts).length > 20_000) return json({ error: 'Send today and the day\'s facts.' }, 400);
  const weights: Weighed[] = (Array.isArray(body?.weights) ? body.weights : [])
    .filter((w: any) => typeof w?.date === 'string' && YMD.test(w.date) && Number.isFinite(w?.weight))
    .map((w: any) => ({ date: w.date, weight: +w.weight }))
    .sort((a: Weighed, b: Weighed) => a.date.localeCompare(b.date))
    .slice(-400);
  const tool = {
    unit: body?.unit === 'lb' ? 'lb' : 'kg',
    goal: ['lose', 'gain', 'hold'].includes(body?.goal) ? body.goal : 'lose',
    goal_weight: Number.isFinite(body?.goal_weight) ? +body.goal_weight : null,
  };
  const problem = typeof body?.problem === 'string' ? body.problem.slice(0, 200) : undefined;

  try {
    const [q] = await embed([question], KB.model);
    const passages = nearest(q, KB.passages, 3, 0.5);
    const r = await runAgent({
      question, today, facts, passages, problem, firstWeighIn: weights[0]?.date ?? null, chat: gemmaTurn,
      callTool: (_name, args) => slimChance(weighInsFor(weights, args, today), tool),
    });
    return json({ ...r, passages: passages.map(({ id, title, url }) => ({ id, title, url })) });
  } catch (e) {
    console.error('[ask]', e);
    return json({ error: 'Busy right now. Try again in a moment.' }, 503);
  }
});
