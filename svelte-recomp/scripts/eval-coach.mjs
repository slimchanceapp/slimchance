// Golden sets for the coach's three jobs, graded by the checks the app runs on
// every reply before a word is shown (decision 0004: "a job moves to the phone
// only when it passes the same tests"). The prompts are read from the coach's
// own source, so this measures what people actually get.
//
//   evening   the evening note and "noticed", 12 situations  -> checkReply
//   plan      meals for the next days, 6 situations           -> checkPlan
//   train     the rest of the training week, 8 situations     -> checkTrainPlan
//
// Like the app, a refused plan is asked once more with facts.problem; the
// evening note gets one try. Engine: Google's open Gemma on Cloudflare's free
// allowance (never a key that can cost money); capped by EVAL_MAX_CALLS.
//   set -a; . ~/.config/recompos/cloudflare-ai.env; set +a; node scripts/eval-coach.mjs
//   JOBS=plan (or evening,train) runs only those.
//
// 2026-11-11 on Gemma 4: evening notes 12/12 and training weeks 8/8 on the
// first try; meal plans 2/6, every miss a day's sum. Since the app fits a
// day's portions to its aim (src/lib/mealPlan.ts checkPlan), 6/6.
import { readFileSync } from 'node:fs';
import { buildFacts, checkReply } from '../src/lib/brain.ts';
import { checkPlan, planFoods } from '../src/lib/mealPlan.ts';
import { checkTrainPlan } from '../src/lib/trainPlan.ts';

const KEY = process.env.CLOUDFLARE_AI_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!KEY || !ACCOUNT) { console.error('CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID missing'); process.exit(1); }
const MODEL = process.env.EVAL_MODEL ?? '@cf/google/gemma-4-26b-a4b-it';
const MAX_CALLS = Number(process.env.EVAL_MAX_CALLS ?? 60);
let calls = 0;

const src = readFileSync(new URL('../../supabase/functions/coach/index.ts', import.meta.url), 'utf8');
const fn = (name) => {
  const body = src.match(new RegExp(`function ${name}\\(facts: [a-z]+\\): string \\{([\\s\\S]*?)\\n\\}\\n`))?.[1];
  if (!body) throw new Error(`${name} not found in the coach`);
  return new Function('facts', body);
};
const PROMPT = { evening: fn('prompt'), plan: fn('planPrompt'), train: fn('trainPrompt') };

async function ask(prompt) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (++calls > MAX_CALLS) { console.error(`Stopped at ${MAX_CALLS} calls (EVAL_MAX_CALLS).`); process.exit(2); }
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 1500, chat_template_kwargs: { enable_thinking: false }, messages: [{ role: 'user', content: prompt }] }),
    });
    if (r.status === 402) { console.error('Out of allowance.'); process.exit(2); }
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2500 * (attempt + 1))); continue; }
    const text = (await r.json()).choices?.[0]?.message?.content ?? '';
    try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { return null; }
  }
  return null;
}

// ---- situations ---------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (date, h = 16) => new Date(`${date}T${pad(h)}:00:00`);
const back = (date, k) => { const d = at(date, 12); d.setDate(d.getDate() - k); return ymd(d); };
const ahead = (date, k) => back(date, -k);

function evening(c) {
  const intake = new Map(), weights = [], trained = new Set(), watch = new Map();
  for (let k = 13; k >= 0; k--) {
    const d = back(c.date, k);
    if (!(c.gaps ?? []).includes(k)) intake.set(d, { kcal: c.kcal[k % c.kcal.length], protein: c.protein[k % c.protein.length], items: 4 });
    if (k % 2 === 0 || k === 0) weights.push({ date: d, weight: +(c.startKg - (13 - k) * c.dailyKg).toFixed(1) });
    if ((c.trainedBack ?? []).includes(k)) { trained.add(d); watch.set(d, 55); }
  }
  return buildFacts({
    now: at(c.date), units: 'kg', toUnit: (kg) => kg,
    trend: { kg: c.startKg - 13 * c.dailyKg + 0.3, lossPerWeekKg: c.dailyKg * 7, pace: c.pace, goalKg: c.goalKg },
    intake, weights, trained, watchMinutes: watch, budget: c.budget, proteinTarget: c.proteinTarget, session: c.session ?? null,
    plans: c.plans ?? null, why: c.why ?? null, usualFoods: ['Greek yogurt', 'Chicken breast', 'Rice', 'Tvaroh', 'Eggs'],
    recentEvenings: c.recent ?? [], notes: c.notes ?? null,
  });
}
const EVENINGS = [
  { name: 'losing, protein short, weekday', date: '2026-11-11', kcal: [1900, 2100, 2000], protein: [90, 110], startKg: 96, dailyKg: 0.07, pace: 'on pace', goalKg: 85, budget: 2050, proteinTarget: 150, trainedBack: [1, 4, 8, 11] },
  { name: 'stalled, Friday', date: '2026-11-13', kcal: [2300, 2600, 2100], protein: [120], startKg: 112, dailyKg: 0, pace: 'stalled', goalKg: 96, budget: 2200, proteinTarget: 170, plans: { 'Friday night': 'one beer, then water' }, why: 'to keep up with my kids' },
  { name: 'session still ahead tonight', date: '2026-11-12', kcal: [1800], protein: [140], startKg: 88, dailyKg: 0.05, pace: 'on pace', goalKg: 80, budget: 1900, proteinTarget: 140, session: 'Upper body at 19:30', trainedBack: [2, 5, 9] },
  { name: 'trained today already', date: '2026-11-10', kcal: [2000], protein: [150], startKg: 101, dailyKg: 0.06, pace: 'on pace', goalKg: 90, budget: 2100, proteinTarget: 160, session: 'Lower body', trainedBack: [0, 3, 7, 10] },
  { name: 'gaining slowly', date: '2026-11-09', kcal: [2700, 2500, 2900], protein: [100], startKg: 104, dailyKg: -0.03, pace: 'gaining', goalKg: 92, budget: 2250, proteinTarget: 155 },
  { name: 'Saturday, big week', date: '2026-11-14', kcal: [2200, 3100, 2400], protein: [130], startKg: 92, dailyKg: 0.03, pace: 'slower', goalKg: 84, budget: 2000, proteinTarget: 145, plans: { 'Saturday': 'walk to the market' } },
  { name: 'gaps in the log', date: '2026-11-11', kcal: [1900, 2200], protein: [120], startKg: 99, dailyKg: 0.05, pace: 'on pace', goalKg: 88, budget: 2100, proteinTarget: 155, gaps: [2, 3, 6, 9, 10] },
  { name: 'repeat risk', date: '2026-11-12', kcal: [2000], protein: [100], startKg: 95, dailyKg: 0.06, pace: 'on pace', goalKg: 85, budget: 2050, proteinTarget: 150, recent: ['Protein is the gap today: a tub of Greek yogurt closes most of it.', 'You have room for a proper dinner tonight; enjoy it.'] },
  { name: 'Sunday, keeping mode near goal', date: '2026-11-15', kcal: [2300], protein: [140], startKg: 81, dailyKg: 0.01, pace: 'holding', goalKg: 80, budget: 2400, proteinTarget: 140 },
  { name: 'Monday after a heavy weekend', date: '2026-11-16', kcal: [2000, 2900, 3200], protein: [120], startKg: 110, dailyKg: 0.04, pace: 'slower', goalKg: 95, budget: 2300, proteinTarget: 170, trainedBack: [3, 6] },
  { name: 'with coach notes', date: '2026-11-11', kcal: [1700, 1900], protein: [130], startKg: 90, dailyKg: 0.08, pace: 'faster than planned', goalKg: 82, budget: 1950, proteinTarget: 145, notes: 'Fasts until about 15:00. Eats tvaroh with whey after 21:00. Responds to concrete food swaps; ignores general advice.' },
  { name: 'first two weeks, little data', date: '2026-11-11', kcal: [2100], protein: [110], startKg: 118, dailyKg: 0.1, pace: 'early days', goalKg: 100, budget: 2400, proteinTarget: 180, gaps: [7, 8, 9, 10, 11, 12, 13] },
];

const PLANS = [
  { name: '3 days, usual foods', today: '2026-11-11', n: 3, dayKcal: 2000, floor: 1500, protein: 150 },
  { name: '2 days, low budget', today: '2026-11-13', n: 2, dayKcal: 1600, floor: 1500, protein: 140 },
  { name: '4 days, high protein', today: '2026-11-10', n: 4, dayKcal: 2300, floor: 1600, protein: 180 },
  { name: '1 day', today: '2026-11-15', n: 1, dayKcal: 1900, floor: 1500, protein: 130 },
  { name: '3 days, near the floor', today: '2026-11-12', n: 3, dayKcal: 1550, floor: 1500, protein: 120 },
  { name: '2 days, notes say fasting', today: '2026-11-11', n: 2, dayKcal: 2100, floor: 1500, protein: 160, notes: 'Fasts until about 15:00; tvaroh with whey after 21:00.' },
];
const USUAL = [{ name: 'Tvaroh', kcal: 98, protein: 17 }, { name: 'Greek yogurt', kcal: 97, protein: 9 }, { name: 'Chicken breast', kcal: 165, protein: 31 }, { name: 'Rice, cooked', kcal: 130, protein: 2.7 }];

const TRAINS = [
  { name: 'two left, five days', today: '2026-11-11', sessions: ['Lower body', 'Upper body'], left: 2, easy: false },
  { name: 'easy day today', today: '2026-11-11', sessions: ['Lower body', 'Upper body'], left: 2, easy: true },
  { name: 'three sessions, PPL', today: '2026-11-10', sessions: ['Push', 'Pull', 'Legs'], left: 3, easy: false },
  { name: 'none left', today: '2026-11-13', sessions: ['Full body'], left: 0, easy: false },
  { name: 'one left, weekend', today: '2026-11-14', sessions: ['Full body'], left: 1, easy: false },
  { name: 'tight: three in three days', today: '2026-11-13', sessions: ['Push', 'Pull', 'Legs'], left: 3, easy: false },
  { name: 'easy today, one left', today: '2026-11-12', sessions: ['Upper body', 'Lower body'], left: 1, easy: true },
  { name: 'Monday, whole week', today: '2026-11-09', sessions: ['Lower body', 'Upper body', 'Full body'], left: 3, easy: false },
];
const toSunday = (today) => { const out = []; for (let d = today; ; d = ahead(d, 1)) { out.push(d); if (at(d, 12).getDay() === 0) break; } return out; };

// ---- run ----------------------------------------------------------------
const results = { evening: [], plan: [], train: [] };
async function run(job, name, facts, grade, tries) {
  let first = null, why = null;
  for (let t = 0; t < tries; t++) {
    const raw = await ask(PROMPT[job](facts));
    const g = grade(raw);
    if (t === 0) first = g.ok;
    if (g.ok) { results[job].push({ name, first, final: true, tries: t + 1 }); return; }
    why = g.why; facts = { ...facts, problem: g.why };
  }
  results[job].push({ name, first, final: false, why });
}

const ONLY = process.env.JOBS?.split(',');
const want = (job) => !ONLY || ONLY.includes(job);
for (const c of want('evening') ? EVENINGS : []) { const f = evening(c); await run('evening', c.name, f, (raw) => checkReply(raw, f), 1); process.stderr.write('.'); }
for (const c of want('plan') ? PLANS : []) {
  const days = Array.from({ length: c.n }, (_, k) => ahead(c.today, k)), foods = planFoods(USUAL);
  const facts = { days, dayKcal: c.dayKcal, floorKcal: c.floor, proteinTargetG: c.protein, foods, notes: c.notes ?? '' };
  await run('plan', c.name, facts, (raw) => checkPlan(raw, { days, dayKcal: c.dayKcal, floorKcal: c.floor, proteinTargetG: c.protein, foods }), 2);
  process.stderr.write('.');
}
for (const c of want('train') ? TRAINS : []) {
  const days = toSunday(c.today);
  const facts = { today: c.today, days, sessions: c.sessions, sessionsLeft: c.left, doneDates: [], easyToday: c.easy, readiness: c.easy ? 'Low' : 'Good', notes: '' };
  await run('train', c.name, facts, (raw) => checkTrainPlan(raw, { days, sessions: c.sessions, left: c.left, easyToday: c.easy, today: c.today }), 2);
  process.stderr.write('.');
}

console.log(`\n${MODEL}, ${calls} calls\n`);
for (const [job, rs] of Object.entries(results).filter(([, rs]) => rs.length)) {
  const first = rs.filter((r) => r.first).length, final = rs.filter((r) => r.final).length;
  console.log(`${job.padEnd(8)} first try ${first}/${rs.length}   after the app's retry ${final}/${rs.length}`);
  for (const r of rs.filter((x) => !x.final || !x.first)) console.log(`   ${r.final ? 'retry fixed' : 'refused'}  ${r.name}${r.why ? `: ${r.why}` : ''}`);
}
