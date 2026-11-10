// Eval: does the AI read a nutrition label right? (2026-11-10)
//
// The truth: 60 popular products from Open Food Facts (12 each sold in
// Slovakia, Czechia, Germany, the UK and the US) with a photo of the label and
// per-100 g values that agree with themselves (4/4/9 within a quarter); data
// (c) Open Food Facts contributors, ODbL: scripts/eval-label-truth.json. Each
// photo goes to the engine with the production label prompt (read from
// supabase/functions/estimate-food at run time). Scored: energy within 5% and
// 10%, protein within 1 g, and answers that couldn't be read.
//
// Engine: Gemma 4 on Cloudflare Workers AI (the free allowance the app also
// uses, so the run is capped well under a day's allowance: EVAL_MAX_CALLS).
// Usage: set -a; . ~/.config/recompos/cloudflare-ai.env; set +a; node scripts/eval-label.mjs [n=60]
import { readFileSync } from 'node:fs';

const TOKEN = process.env.CLOUDFLARE_AI_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) { console.error('CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID missing'); process.exit(1); }
const MODEL = process.env.EVAL_MODEL ?? '@cf/google/gemma-4-26b-a4b-it';
const MAX_CALLS = Number(process.env.EVAL_MAX_CALLS ?? 120);
let calls = 0;
const truth = JSON.parse(readFileSync(new URL('./eval-label-truth.json', import.meta.url), 'utf8')).slice(0, Number(process.argv[2] ?? 60));
const src = readFileSync(new URL('../../supabase/functions/estimate-food/index.ts', import.meta.url), 'utf8');
const PROMPT = src.slice(src.indexOf('const LABEL_PROMPT = `') + 'const LABEL_PROMPT = `'.length).split('`;')[0];

async function read(t) {
  const img = Buffer.from(await (await fetch(t.image, { headers: { 'User-Agent': 'SlimChance/1.0 (slimchance.app)' } })).arrayBuffer());
  if (++calls > MAX_CALLS) { console.error(`Stopped at ${MAX_CALLS} calls (EVAL_MAX_CALLS).`); process.exit(2); }
  const started = Date.now();
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 1500, chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${img.toString('base64')}` } }] }] }),
  });
  const ms = Date.now() - started;
  if (!r.ok) return { ms, error: `HTTP ${r.status}` };
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content ?? '';
  try {
    const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return { ms, kcal: Number(o.per100?.kcal), protein: Number(o.per100?.protein_g), neurons: d.usage?.neurons ?? 0 };
  } catch { return { ms, error: 'unreadable answer' }; }
}

const rows = [];
for (let i = 0; i < truth.length; i += 4) {
  rows.push(...await Promise.all(truth.slice(i, i + 4).map(async (t) => ({ t, r: await read(t).catch((e) => ({ error: String(e).slice(0, 60) })) }))));
  process.stderr.write(`${rows.length}/${truth.length} `);
}
const ok = rows.filter((x) => !x.r.error && x.r.kcal > 0);
const near = (a, b, f) => Math.abs(a - b) <= f * Math.max(b, 1);
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
console.log(JSON.stringify({
  model: MODEL, labels: rows.length, answered: ok.length,
  kcalWithin5: `${Math.round(ok.filter((x) => near(x.r.kcal, x.t.kcal, 0.05)).length / rows.length * 100)}%`,
  kcalWithin10: `${Math.round(ok.filter((x) => near(x.r.kcal, x.t.kcal, 0.10)).length / rows.length * 100)}%`,
  proteinWithin1g: `${Math.round(ok.filter((x) => Math.abs(x.r.protein - x.t.protein) <= 1).length / rows.length * 100)}%`,
  medianSeconds: med(rows.filter((x) => x.r.ms).map((x) => x.r.ms / 1000)),
  neurons: Math.round(rows.reduce((s, x) => s + (x.r.neurons ?? 0), 0)),
  byCountry: Object.fromEntries([...new Set(rows.map((x) => x.t.country))].map((c) => { const g = rows.filter((x) => x.t.country === c); return [c, `${g.filter((x) => !x.r.error && near(x.r.kcal, x.t.kcal, 0.10)).length}/${g.length}`]; })),
}, null, 2));
if (process.env.EVAL_ROWS) console.log(JSON.stringify(rows.map((x) => ({ code: x.t.code, country: x.t.country, want: [x.t.kcal, x.t.protein], got: x.r.error ?? [x.r.kcal, x.r.protein] }))));
