// Does retrieval find the passage that answers a question? 15 questions as
// people ask them, each with the passage(s) that answer it; scored as recall@3
// (the right passage among the three returned) and the mean reciprocal rank.
// One embedding call on Cloudflare's free allowance.
//   set -a; . ~/.config/recompos/cloudflare-ai.env; set +a; node scripts/eval-retrieval.mjs
import { readFileSync } from 'node:fs';
import { nearest } from '../../supabase/functions/_shared/knowledge.ts';

const KEY = process.env.CLOUDFLARE_AI_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!KEY || !ACCOUNT) { console.error('CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID missing'); process.exit(1); }
const kb = JSON.parse(readFileSync(new URL('../../supabase/functions/_shared/knowledge.json', import.meta.url), 'utf8'));

const CASES = [
  ['Why did I gain a kilo overnight?', ['why-the-scale-went-up#it-can-t-be-fat', 'why-the-scale-went-up#what-does-move-it-and-by-how-much', 'why-the-scale-went-up#lead']],
  ['I had a salty dinner and now the scale is up', ['why-the-scale-went-up#what-does-move-it-and-by-how-much']],
  ['Should I weigh myself every day?', ['why-the-scale-went-up#how-to-read-your-weight']],
  ['What does the app do when my weight jumps?', ['why-the-scale-went-up#what-slim-chance-does-with-a-morning-like-this']],
  ['I never log the oil I cook with, does it matter?', ['consistent-beats-accurate#every-food-log-is-short', 'consistent-beats-accurate#why-it-doesn-t-break-a-learned-budget', 'faq#i-don-t-log-everything-i-eat-will-it-sti']],
  ['Do I have to log everything I eat?', ['faq#i-don-t-log-everything-i-eat-will-it-sti', 'consistent-beats-accurate#lead', 'consistent-beats-accurate#every-food-log-is-short']],
  ['Why is my calorie budget not just a formula?', ['consistent-beats-accurate#why-it-breaks-a-formula-budget', 'consistent-beats-accurate#why-it-doesn-t-break-a-learned-budget']],
  ['Is this app free?', ['faq#is-slim-chance-free']],
  ['Can I use stone instead of kilos?', ['faq#can-i-use-pounds-or-stone']],
  ['How do I move my data from Happy Scale?', ['faq#can-i-bring-my-weigh-ins-from-another-ap']],
  ['What happens once I hit my goal weight?', ['faq#what-happens-when-i-reach-my-goal']],
  ['My weight goes up before my period', ['faq#my-weight-jumps-before-my-period-can-sli']],
  ['I only walk, I never go to the gym', ['faq#i-don-t-go-to-a-gym-is-it-for-me']],
  ['Is this medical advice?', ['faq#is-it-a-medical-app']],
  ['Does it work on my iPhone?', ['faq#does-it-work-on-iphone']],
];

const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/${kb.model}`, {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ text: CASES.map(([q]) => q) }),
});
const vecs = (await r.json()).result?.data;
if (!Array.isArray(vecs)) { console.error('embedding failed'); process.exit(1); }

let hits = 0, rr = 0;
CASES.forEach(([q, want], i) => {
  const got = nearest(vecs[i], kb.passages, 3, 0);
  const rank = got.findIndex((p) => want.includes(p.id));
  if (rank >= 0) { hits++; rr += 1 / (rank + 1); }
  console.log(`${rank >= 0 ? `hit@${rank + 1}` : 'MISS '}  ${q}  ->  ${got.map((p) => `${p.id} (${p.score.toFixed(2)})`).join(', ')}`);
});
console.log(`\nrecall@3 ${hits}/${CASES.length}, mean reciprocal rank ${(rr / CASES.length).toFixed(2)}`);
