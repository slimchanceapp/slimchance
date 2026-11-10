// Eval: how close is "describe what you ate" to the truth? (2026-11-10)
//
// The truth: 150 generic foods drawn at random from USDA's SR Legacy table
// (6,464 foods with lab-measured calories, public domain; scripts/eval-food-
// truth.json), each with a random portion. Two estimators:
//   ai       the production prompt (read from supabase/functions/estimate-food
//            at run time, so this can't drift from what the app sends) to
//            Gemini with the production settings
//   offline  the app's no-AI fallback, estimateLocally in src/lib/food.ts
// Scored by the typical error (median of |estimate - truth| / truth), the share
// within 20%, and the lean (median signed error: + means it guesses high).
//
// Usage: set -a; . ~/.config/recompos/cloudflare-ai.env; set +a; node scripts/eval-food.mjs [n=150]   (EVAL_ENGINE=gemini: its own key)
import { readFileSync } from 'node:fs';
import { estimateLocally } from '../src/lib/food.ts';

// Engines: EVAL_ENGINE=gemma (default) runs Google's open Gemma 4 on Cloudflare
// Workers AI, the free allowance the app also uses, so the run is capped well
// under a day's allowance; EVAL_ENGINE=gemini needs EVAL_GEMINI_API_KEY from a
// separate project, never the app's key (2026-11-10: an eval run on it used up
// the prepaid credit and took photos and the coach down for everyone).
const ENGINE = process.env.EVAL_ENGINE ?? 'gemma';
const KEY = ENGINE === 'gemini' ? process.env.EVAL_GEMINI_API_KEY : process.env.CLOUDFLARE_AI_TOKEN;
if (ENGINE === 'gemini' && !KEY) { console.error('EVAL_GEMINI_API_KEY missing: evals use their own key, never the app\'s.'); process.exit(1); }
if (ENGINE === 'gemini' && KEY === process.env.GEMINI_API_KEY) { console.error('That is the app\'s key. Evals use a separate project.'); process.exit(1); }
if (ENGINE === 'gemma' && (!KEY || !process.env.CLOUDFLARE_ACCOUNT_ID)) { console.error('CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID missing'); process.exit(1); }
let calls = 0;
const MAX_CALLS = Number(process.env.EVAL_MAX_CALLS ?? 400);
const spend = () => { if (++calls > MAX_CALLS) { console.error(`Stopped at ${MAX_CALLS} calls (EVAL_MAX_CALLS).`); process.exit(2); } };
const MODEL = process.env.EVAL_MODEL ?? (ENGINE === 'gemini' ? 'gemini-3.5-flash' : '@cf/google/gemma-4-26b-a4b-it');
const truth = JSON.parse(readFileSync(new URL('./eval-food-truth.json', import.meta.url), 'utf8')).slice(0, Number(process.argv[2] ?? 150));

const src = readFileSync(new URL('../../supabase/functions/estimate-food/index.ts', import.meta.url), 'utf8');
const body = src.match(/function mealPrompt\(desc: string, hasImage: boolean\): string \{([\s\S]*?)\n\}\n/)?.[1];
if (!body) throw new Error('mealPrompt not found in estimate-food');
const mealPrompt = new Function('desc', 'hasImage', body);

async function ai(desc) {
  for (let attempt = 0; attempt < 4; attempt++) {
    spend();
    const r = ENGINE === 'gemini'
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: mealPrompt(desc, false) }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2, thinkingConfig: { thinkingLevel: 'minimal' } } }),
      })
      : await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 1500, chat_template_kwargs: { enable_thinking: false },
          messages: [{ role: 'user', content: mealPrompt(desc, false) }] }),
      });
    if (r.status === 402) { console.error('This key is out of credit.'); process.exit(2); }
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * (attempt + 1))); continue; }
    const j = await r.json();
    const text = ENGINE === 'gemini' ? (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('') : (j.choices?.[0]?.message?.content ?? '');
    try {
      const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const k = Number(o.kcal) || (Array.isArray(o.items) ? o.items.reduce((t, i) => t + (Number(i.kcal) || 0), 0) : 0);
      return k > 0 ? k : null;
    } catch { return null; }
  }
  return null;
}

const rows = [];
for (let i = 0; i < truth.length; i += 6) {
  rows.push(...await Promise.all(truth.slice(i, i + 6).map(async (t) => {
    const desc = `${t.grams} g ${t.desc}`, want = (t.kcal100 * t.grams) / 100;
    const local = estimateLocally(desc, []);
    return { desc, category: t.category, want, ai: await ai(desc), offline: local?.total?.kcal ?? null };
  })));
  process.stderr.write(`${rows.length}/${truth.length} `);
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const score = (k) => {
  const ok = rows.filter((r) => r[k] != null && r.want > 0);
  const errs = ok.map((r) => (r[k] - r.want) / r.want);
  return { answered: `${ok.length}/${rows.length}`, typicalError: `${Math.round(med(errs.map(Math.abs)) * 100)}%`,
    within20: `${Math.round((errs.filter((e) => Math.abs(e) <= 0.2).length / ok.length) * 100)}%`, lean: `${Math.round(med(errs) * 100)}%`,
    offByHalf: errs.filter((e) => Math.abs(e) > 0.5).length };
};
console.log(JSON.stringify({ model: MODEL, foods: rows.length, ai: score('ai'), offline: score('offline') }, null, 2));
if (process.env.EVAL_ROWS) console.log(JSON.stringify(rows));
