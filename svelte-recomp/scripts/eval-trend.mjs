// Eval: does a general AI judge "is this person really losing weight?"
// better with Slim Chance's MCP tool than without it? (2026-11-10)
//
// Made-up people with a KNOWN true rate (so the right answer is known):
// a start weight, a true weekly rate, daily water noise that carries over
// from one morning to the next, and missed mornings. The same question goes
// to a model three ways:
//   alone      the model reads the numbers and judges
//   with tool  the model is offered the live MCP tools and decides itself
//              whether to call them (nothing tells it to)
//   tool only  our own function, no model
// Scored by the Brier score (mean squared error of the chance; 0 is perfect,
// 0.25 is a coin toss) and by confident mistakes (8+ in 10 when not truly
// losing, or 2 or less when truly losing).
//
// Usage: set -a; . ~/.config/recompos/gemini-new.env; set +a; node scripts/eval-trend.mjs [people=40]
import { slimChance } from '../src/lib/mcp.ts';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY missing'); process.exit(1); }
const MODEL = process.env.EVAL_MODEL ?? 'gemini-3.5-flash';
const MCP = process.env.EVAL_MCP ?? 'https://slimchance.app/mcp';
const N = Number(process.argv[2] ?? 40);
const THRESHOLD = 0.15; // kg/week, what the app calls a loss that counts

let seed = 20261110;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const ymd = (d) => d.toISOString().slice(0, 10);

function person(i) {
  const rate = pick([-0.2, 0, 0.1, 0.2, 0.35, 0.6]), sigma = pick([0.4, 0.7, 1.0]), days = pick([10, 16, 24, 32]);
  const start = 80 + rnd() * 30, end = new Date(Date.UTC(2026, 10, 9));
  const out = []; let e = 0;
  for (let k = days - 1; k >= 0; k--) {
    e = 0.4 * e + Math.sqrt(1 - 0.16) * sigma * gauss();
    if (rnd() < 0.15) continue; // a missed morning
    const d = new Date(end); d.setUTCDate(end.getUTCDate() - k);
    out.push({ date: ymd(d), weight: +(start - (rate / 7) * (days - 1 - k) + e).toFixed(1) });
  }
  return { id: i, rate, sigma, losing: rate > THRESHOLD, weigh_ins: out };
}

const question = (p) => `Here are someone's morning scale readings (date, kg):\n${p.weigh_ins.map((w) => `${w.date} ${w.weight}`).join('\n')}\n\n` +
  `Is this person really losing weight, faster than ${THRESHOLD} kg a week, or could the change be day-to-day scale noise? ` +
  `Reply with only a JSON object: {"chance_in_10": <integer 0-10: your probability that they are truly losing faster than ${THRESHOLD} kg a week, times 10>, "verdict": "losing" | "not losing" | "too early to tell"}`;

async function gemini(body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * (attempt + 1))); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(`gemini ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  }
  throw new Error('gemini kept failing');
}
async function mcp(method, params) {
  const r = await fetch(MCP, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
}
const parse = (text) => { const m = text?.match(/\{[^{}]*"chance_in_10"[^{}]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const textOf = (j) => (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');

async function alone(p) {
  return parse(textOf(await gemini({ contents: [{ role: 'user', parts: [{ text: question(p) }] }] })));
}
async function withTool(p, tools) {
  const contents = [{ role: 'user', parts: [{ text: question(p) }] }];
  let called = 0;
  for (let turn = 0; turn < 4; turn++) {
    const j = await gemini({ contents, tools: [{ functionDeclarations: tools }] });
    const content = j.candidates?.[0]?.content;
    const calls = (content?.parts ?? []).filter((x) => x.functionCall);
    if (!calls.length) return { ...(parse(textOf(j)) ?? {}), called };
    contents.push(content);
    const replies = [];
    for (const c of calls) {
      called++;
      const res = await mcp('tools/call', { name: c.functionCall.name, arguments: c.functionCall.args });
      replies.push({ functionResponse: { name: c.functionCall.name, response: { text: res?.content?.[0]?.text, data: res?.structuredContent ?? null } } });
    }
    contents.push({ role: 'user', parts: replies });
  }
  return { called };
}

const score = (rows, key) => {
  const ok = rows.filter((r) => r[key]?.chance_in_10 != null);
  const brier = ok.reduce((s, r) => s + (r[key].chance_in_10 / 10 - (r.losing ? 1 : 0)) ** 2, 0) / ok.length;
  const confidentWrong = ok.filter((r) => (r[key].chance_in_10 >= 8 && !r.losing) || (r[key].chance_in_10 <= 2 && r.losing)).length;
  return { answered: ok.length, brier: +brier.toFixed(3), confidentWrong };
};

const { tools } = await mcp('tools/list', {});
const decls = tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema }));
const people = Array.from({ length: N }, (_, i) => person(i));
const rows = [];
for (let i = 0; i < people.length; i += 4) {
  const batch = await Promise.all(people.slice(i, i + 4).map(async (p) => {
    const own = slimChance({ weigh_ins: p.weigh_ins }).structuredContent;
    const [a, t] = await Promise.all([alone(p).catch(() => null), withTool(p, decls).catch((e) => ({ error: String(e) }))]);
    return { id: p.id, rate: p.rate, sigma: p.sigma, n: p.weigh_ins.length, losing: p.losing, alone: a, withTool: t,
      toolOnly: { chance_in_10: own.chance_in_10 ?? 5, state: own.state } };
  }));
  rows.push(...batch);
  process.stderr.write(`${rows.length}/${N} `);
}
const used = rows.filter((r) => r.withTool?.called > 0).length;
const summary = { model: MODEL, people: N, alone: score(rows, 'alone'), withTool: { ...score(rows, 'withTool'), choseTheTool: used }, toolOnly: score(rows, 'toolOnly') };
console.log(JSON.stringify(summary, null, 2));
if (process.env.EVAL_ROWS) console.log(JSON.stringify(rows));
