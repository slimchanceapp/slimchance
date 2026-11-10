// food-search — a CORS-capable doorway to Open Food Facts search.
//
// WHY (2026-10-16): the app searched OFF from the browser via /cgi/search.pl,
// which — like /api/v2/search — now answers 503. OFF's working search
// (search.openfoodfacts.org) sends no CORS headers, so a browser can't call it
// at all: food search had silently stopped finding anything.
//
// Deliberately thin. It runs a Slovakia/Czechia query and a world query in
// parallel and returns the raw hits, de-duplicated. Normalising (kJ-only
// products, names in any language) and ranking happen in the app, in
// src/lib/food.ts, where they are unit-tested and shared with barcode lookups.
//
//   POST {"q": "pilos tvaroh"}       -> {"hits": [...]}
//   POST {"code": "8585002503541"}   -> {"hits": [one product]}   (barcode fallback)
//                                    -> {"hits": [], "usda": food}  when only USDA knows it
//
// USDA FoodData Central (2026-11-10): asked only when Open Food Facts has no
// product for a code. Its branded foods cover most packaged food sold in the
// US, where Open Food Facts is thinner. The raw food goes back; the app shapes
// it (src/lib/food.ts usdaCandidate). The key travels in a header, never a URL.

import { corsHeaders, json } from '../_shared/llm.ts';
import { gate } from '../_shared/auth.ts';

const SAL = 'https://search.openfoodfacts.org/search';
const FDC = 'https://api.nal.usda.gov/fdc/v1/foods/search';
// ponytail: DEMO_KEY until the project's own key is in the secrets; it is
// rate-limited per address, so a busy day degrades to "not found", as before.
const FDC_KEY = Deno.env.get('FDC_API_KEY') ?? 'DEMO_KEY';
const FIELDS = [
  'code', 'product_name', 'product_name_sk', 'product_name_cs', 'product_name_en', 'product_name_de',
  'product_name_pl', 'product_name_hu', 'generic_name', 'brands', 'nutriments', 'serving_quantity',
  'product_quantity', 'countries_tags', 'unique_scans_n',
].join(',');

async function sal(q: string, size: number): Promise<Record<string, unknown>[]> {
  const url = `${SAL}?${new URLSearchParams({ q, langs: 'sk,cs,en', page_size: String(size), fields: FIELDS })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'SlimChance/1.0 (slimchance.app)' } });
  if (!res.ok) throw new Error(`OFF search HTTP ${res.status}`);
  return (await res.json())?.hits ?? [];
}

/** USDA's branded food for exactly this code, or null. */
async function usda(code: string): Promise<Record<string, unknown> | null> {
  const url = `${FDC}?${new URLSearchParams({ query: code, dataType: 'Branded', pageSize: '3' })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'X-Api-Key': FDC_KEY } });
  if (!res.ok) throw new Error(`USDA HTTP ${res.status}`);
  const want = code.replace(/^0+/, '');
  return ((await res.json())?.foods ?? []).find((f: any) => String(f?.gtinUpc ?? '').replace(/^0+/, '') === want) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const refused = await gate(req, 'search');
  if (refused) return refused;
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON.' }, 400); }

  const code = typeof body?.code === 'string' && /^\d{6,14}$/.test(body.code) ? body.code : null;
  const q = typeof body?.q === 'string' ? body.q.trim().slice(0, 80) : '';
  if (!code && q.length < 2) return json({ hits: [] });

  // Lucene syntax: strip characters that would turn the user's words into operators.
  const safe = q.replace(/[+\-=&|><!(){}\[\]^"~*?:\\/]/g, ' ');
  // A US barcode is 12 digits; Open Food Facts files it as 13 with a leading 0.
  const queries = code
    ? [sal(code.length === 12 ? `code:(${code} OR 0${code})` : `code:${code}`, 1)]
    : [sal(`${safe} (countries_tags:"en:slovakia" OR countries_tags:"en:czech-republic")`, 24), sal(safe, 24)];
  const settled = await Promise.allSettled(queries);
  const seen = new Set<unknown>();
  const hits = settled
    .flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
    .filter((h) => !seen.has(h.code) && seen.add(h.code));
  if (code && !hits.length) {
    const food = await usda(code).catch(() => null);
    if (food) return json({ hits: [], usda: food });
  }
  if (settled.every((s) => s.status === 'rejected')) {
    return json({ hits: [], error: 'Open Food Facts search is down right now.' });
  }
  return json({ hits });
});
