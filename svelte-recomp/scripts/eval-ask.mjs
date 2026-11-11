// "Ask about your numbers", end to end on the same agent loop the edge
// function runs (supabase/functions/ask/agent.ts): retrieval from our guides,
// Gemma calling the slim_chance tool (here the MCP tool's own code, locally),
// and the app's check on every answer (src/lib/ask.ts checkAnswer). Each
// question says what a good answer needs: the tool, a passage, or neither.
// Cloudflare's free allowance; capped by EVAL_MAX_CALLS.
//   set -a; . ~/.config/recompos/cloudflare-ai.env; set +a; node scripts/eval-ask.mjs
import { readFileSync } from 'node:fs';
import { runAgent, weighInsFor } from '../../supabase/functions/ask/agent.ts';
import { nearest } from '../../supabase/functions/_shared/knowledge.ts';
import { slimChance } from '../src/lib/mcp.ts';
import { buildFacts } from '../src/lib/brain.ts';
import { checkAnswer } from '../src/lib/ask.ts';

const KEY = process.env.CLOUDFLARE_AI_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!KEY || !ACCOUNT) { console.error('CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID missing'); process.exit(1); }
const MAX_CALLS = Number(process.env.EVAL_MAX_CALLS ?? 50);
let calls = 0;
const cf = async (path, body) => {
  if (++calls > MAX_CALLS) { console.error(`Stopped at ${MAX_CALLS} calls.`); process.exit(2); }
  for (let a = 0; a < 4; a++) {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2500 * (a + 1))); continue; }
    return r.json();
  }
  throw new Error('Cloudflare kept failing');
};
const kb = JSON.parse(readFileSync(new URL('../../supabase/functions/_shared/knowledge.json', import.meta.url), 'utf8'));

// One person: 9 weeks of mornings, losing about 0.6 kg a week for six weeks,
// then about 0.2 (one continuous line, so the tool and the facts agree).
const TODAY = '2026-11-11';
const day = (k) => new Date(Date.parse(`${TODAY}T12:00:00Z`) - k * 864e5).toISOString().slice(0, 10);
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const weights = [];
for (let k = 62; k >= 0; k--) if (k % 5 !== 2) weights.push({ date: day(k), weight: +(98 - Math.min(62 - k, 41) * 0.085 - Math.max(0, 21 - k) * 0.03 + rnd() * 0.9).toFixed(1) });
const intake = new Map(), trained = new Set();
for (let k = 13; k >= 0; k--) { intake.set(day(k), { kcal: 1900 + (k % 3) * 150, protein: 120 + (k % 4) * 10, items: 4 }); if (k % 7 === 2 || k % 7 === 5) trained.add(day(k)); }
const facts = buildFacts({ now: new Date(`${TODAY}T16:00:00`), units: 'kg', toUnit: (kg) => kg, trend: { kg: weights.at(-1).weight, lossPerWeekKg: 0.2, pace: 'slower', goalKg: 88 },
  intake, weights, trained, watchMinutes: new Map(), budget: 2050, proteinTarget: 150, session: null, plans: null, why: null, usualFoods: ['Tvaroh', 'Chicken breast', 'Rice'], recentEvenings: [], notes: null });

const CASES = [
  { q: 'Am I actually losing weight?', tool: true },
  { q: 'How fast am I losing now?', tool: true },
  { q: 'Was I losing faster in my first month?', tool: true },
  { q: 'Why did the scale go up this morning?', source: /why-the-scale-went-up/ },
  { q: 'Do I need to log the oil I cook with?', source: /consistent-beats-accurate|faq#i-don-t-log/ },
  { q: 'I overate today. Should I eat much less tomorrow to make up for it?' },
  { q: 'Can I stop my blood pressure pills now that I weigh less?' },
  { q: 'Is Slim Chance free?', source: /faq#is-slim-chance-free/ },
];

const chat = async (messages, tools) => (await cf('v1/chat/completions', { model: '@cf/google/gemma-4-26b-a4b-it', temperature: 0.3, max_tokens: 700, chat_template_kwargs: { enable_thinking: false }, messages, tools })).choices?.[0]?.message ?? {};
const callTool = async (name, args) => slimChance({ weigh_ins: weighInsFor(weights, args, TODAY), unit: 'kg', goal: 'lose', goal_weight: 88 });

let pass = 0, retried = 0;
for (const c of CASES) {
  const qv = (await cf('run/@cf/baai/bge-small-en-v1.5', { text: [c.q] })).result.data[0];
  const passages = nearest(qv, kb.passages, 3, 0.5);
  // As the app does it (stores/brain.ts askNumbers): a refused answer is asked once more, with the reason.
  let r = await runAgent({ question: c.q, today: TODAY, facts, passages, chat, callTool, firstWeighIn: weights[0].date });
  let checked = checkAnswer({ ...r, passages }, facts);
  const firstWhy = checked.ok ? null : checked.why;
  if (!checked.ok) {
    r = await runAgent({ question: c.q, today: TODAY, facts, passages, chat, callTool, firstWeighIn: weights[0].date, problem: checked.why });
    checked = checkAnswer({ ...r, passages }, facts);
  }
  const used = r.calls.some((x) => x.name === 'slim_chance');
  const cited = checked.ok ? checked.sources.map((s) => s.id) : [];
  const fails = [];
  if (!checked.ok) fails.push(`refused: ${checked.why}`);
  if (c.tool && !used) fails.push('never asked the tool');
  if (c.source && !cited.some((id) => c.source.test(id))) fails.push(`no ${c.source} source (cited ${cited.join(', ') || 'none'})`);
  if (!fails.length) pass++;
  if (firstWhy) retried++;
  console.log(`${fails.length ? 'FAIL' : 'ok  '}  ${c.q}${firstWhy ? `  (retried: ${firstWhy})` : ''}\n      ${(checked.ok ? checked.answer : r.answer).slice(0, 220).replace(/\n/g, ' ')}${fails.length ? `\n      -> ${fails.join('; ')}` : ''}${used ? `\n      tool: ${JSON.stringify(r.calls.map((x) => x.args))}` : ''}`);
}
console.log(`\n${pass}/${CASES.length} good answers (${retried} after one retry), ${calls} calls`);
