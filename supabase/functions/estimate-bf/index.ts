// estimate-bf — body-fat % and a per-region read from one physique photo.
//
// It called gemini-2.5-flash directly, which Google has since retired (404 for
// this key, measured 2026-10-16), and it answered no CORS preflight — so from
// the app it failed twice over. It now uses the shared hedged provider chain
// (../_shared/llm.ts) and the standard CORS handling.

import { ask, corsHeaders, extractJson, GEMINI_PAID, imageFrom, json } from '../_shared/llm.ts';
import { gate } from '../_shared/auth.ts';

const prompt = (gender: string) => `You are a physique and body-composition coach analysing a single photo.
Gender: ${gender}
Judge from visible muscle definition, muscularity, vascularity, body shape and fat distribution.

Return ONLY minified JSON (no markdown, no prose) in exactly this shape:
{"percent": <number, estimated body-fat % 3-60>,
 "regions": [
   {"key":"shoulders","label":"Shoulders","score":<0-100>,"note":"<=6 words"},
   {"key":"chest","label":"Chest","score":<0-100>,"note":"<=6 words"},
   {"key":"arms","label":"Arms","score":<0-100>,"note":"<=6 words"},
   {"key":"back","label":"Back","score":<0-100>,"note":"<=6 words"},
   {"key":"core","label":"Core","score":<0-100>,"note":"<=6 words"},
   {"key":"legs","label":"Legs","score":<0-100>,"note":"<=6 words"}
 ],
 "summary":"<one <=14-word coaching line>"}
"score" = how lean/developed that region looks (higher is better). If a region is not visible in the photo, still give your best estimate. Be realistic and consistent.`;

function parse(text: string) {
  const o = extractJson(text) as Record<string, any> | null;
  const percent = Number(o?.percent);
  if (!o || !Number.isFinite(percent) || percent < 3 || percent > 60) throw new Error('no plausible body-fat %');
  const regions = (Array.isArray(o.regions) ? o.regions : [])
    .filter((r: any) => r && Number.isFinite(Number(r.score)))
    .map((r: any) => ({
      key: String(r.key || r.label || '').toLowerCase().slice(0, 20),
      label: String(r.label || r.key || '').slice(0, 24),
      score: Math.max(0, Math.min(100, Math.round(Number(r.score)))),
      note: String(r.note || '').slice(0, 60),
    }));
  return {
    estimate: `${percent.toFixed(1)}%`, percent, regions,
    summary: typeof o.summary === 'string' ? o.summary.slice(0, 160) : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // A body photo is the most private thing anyone sends Slim Chance. It goes only
  // to Gemini's paid tier, where Google doesn't use it or have people read it.
  if (!GEMINI_PAID) return json({ error: 'Body-fat estimates from photos are off until Slim Chance’s AI runs on a private tier, so nobody at Google can see your photos. You can still enter a body-fat % yourself.' }, 503);
  const refused = await gate(req, 'ai');
  if (refused) return refused;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON.' }, 400); }
  const image = imageFrom(body?.image);
  const gender = typeof body?.gender === 'string' ? body.gender.slice(0, 20) : '';
  if (!image || !gender) return json({ error: 'Missing image or gender' }, 400);

  try {
    const { value, provider } = await ask({ prompt: prompt(gender), image }, parse, { only: body?.only });
    return json({ ...value, provider });
  } catch (e) {
    console.error('estimate-bf failed', JSON.stringify((e as any)?.errors ?? String(e)));
    return json({ error: 'Every photo-analysis service is busy or down right now.', estimate: 'Could not estimate — try again in a minute', regions: [] });
  }
});
