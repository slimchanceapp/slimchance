// estimate-food — a meal description, a meal photo, or a photo of a packaged
// food's nutrition table in; macros out. The provider chain (Gemini, then two
// keyless free services, hedged) lives in ../_shared/llm.ts — see there for why
// this used to hang for minutes.
//
//   POST {"description": "2 rožky s maslom a šunkou"}             meal from text
//   POST {"image": "data:image/jpeg;base64,…", "description"?: …}  meal from photo
//   POST {"image": …, "mode": "label"}                            per-100 g from a label
//   add "only": ["pollinations"] to exercise one fallback on its own.

import { ask, corsHeaders, extractJson, imageFrom, json, outOfCredit, Refusal } from '../_shared/llm.ts';
import { gate, providersFor } from '../_shared/auth.ts';

type Macros = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
type Item = Macros & { name: string; grams: number | null };

// The user's words go FIRST. With a context sentence leading, a weak free model
// read "kurací rezeň" (chicken schnitzel) as "curry with vegetables" — it latched
// onto the context instead of the dish it was given.
function mealPrompt(desc: string, hasImage: boolean): string {
  const task = hasImage
    ? `Identify the food in this photo and estimate the ACTUAL portion shown — judge the quantity from the plate, bowl, hand or packaging, not a generic serving.${desc ? `\nThe user adds: "${desc}". Treat stated quantities, brands and cooking methods as fact.` : ''}`
    : `Estimate the nutrition of exactly this, as eaten: "${desc}".\nTreat stated quantities, brands and cooking methods as fact. Do not substitute a different dish.`;
  return `${task}
Context: the user lives in Slovakia, so names may be Slovak or Czech, and products may come from Lidl, Kaufland, Tesco or Billa.
If no quantity is given, assume one typical adult serving and put the assumed amount in the item name (e.g. "~250 g").
Split a mixed meal into its main components. Alcohol has 7 kcal per gram, so drinks can carry more kcal than their macros explain.
Reply with JSON only:
{"name":"<short name of the whole meal>","items":[{"name":"...","grams":<number>,"kcal":<n>,"protein_g":<n>,"carbs_g":<n>,"fat_g":<n>}],"kcal":<total>,"protein_g":<total>,"carbs_g":<total>,"fat_g":<total>,"confidence":"low"|"medium"|"high"}
If there is nothing edible to estimate, reply {"error":"<one short reason>"}.`;
}

const LABEL_PROMPT = `This photo shows a packaged food: ideally its nutrition table — Slovak, Czech, German, Polish, Hungarian or English (e.g. "Výživové údaje", "Energetická hodnota", "Tuky", "Sacharidy", "Bielkoviny", "Nährwerte").
If a nutrition table is visible, READ the values per 100 g (or per 100 ml). Rows on curved packs are often misaligned with their numbers: match each value to its row carefully, and never report a "z toho"/"of which" sub-row (saturates, sugars) as the main value. If energy is printed only in kJ, convert with kcal = kJ / 4.184.
If no table is visible but you recognise the exact product, give its usual per-100 g values instead.
Also give the product name and the package or serving size in grams if visible.
Reply with JSON only:
{"name":"<product name or null>","source":"label"|"recognized","per100":{"kcal":<n>,"protein_g":<n>,"carbs_g":<n>,"fat_g":<n>},"serving_g":<n or null>,"package_g":<n or null>}
If you can neither read a table nor recognise the product, reply {"error":"Couldn't read a nutrition table — fit the whole table in the frame, flat and well lit."}`;

const n = (v: unknown): number | null => {
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : null;
};

function macros(o: Record<string, any>): Macros | null {
  const p = n(o.protein_g ?? o.protein), c = n(o.carbs_g ?? o.carbs), f = n(o.fat_g ?? o.fat);
  let k = n(o.kcal ?? o.calories);
  if (p == null && c == null && f == null && k == null) return null;
  if (!k && (p || c || f)) k = Math.round(4 * (p ?? 0) + 4 * (c ?? 0) + 9 * (f ?? 0));
  return { kcal: k ?? 0, protein_g: p ?? 0, carbs_g: c ?? 0, fat_g: f ?? 0 };
}

function objectOrRefusal(text: string): Record<string, any> {
  const o = extractJson(text) as Record<string, any> | null;
  if (!o) throw new Error('no JSON in reply');
  if (typeof o.error === 'string' && o.error.trim()) throw new Refusal(o.error.trim().slice(0, 200));
  return o;
}

function parseMeal(text: string) {
  const o = objectOrRefusal(text);
  const items: Item[] = Array.isArray(o.items)
    ? o.items.flatMap((it: any) => {
      const m = it && typeof it === 'object' ? macros(it) : null;
      return m && typeof it.name === 'string' ? [{ ...m, name: it.name.trim().slice(0, 120), grams: n(it.grams) }] : [];
    })
    : [];
  let total = macros(o);
  if ((!total || total.kcal === 0) && items.length) {
    total = items.reduce((t, i) => ({
      kcal: t.kcal + i.kcal, protein_g: t.protein_g + i.protein_g, carbs_g: t.carbs_g + i.carbs_g, fat_g: t.fat_g + i.fat_g,
    }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  }
  if (!total) throw new Error('no totals');
  if (total.kcal > 8000) throw new Error('implausible total');
  return {
    mode: 'meal' as const, ...total, items,
    confidence: ['low', 'medium', 'high'].includes(o.confidence) ? o.confidence : 'medium',
    name: (typeof o.name === 'string' && o.name.trim() ? o.name.trim() : items[0]?.name ?? 'Meal').slice(0, 120),
  };
}

function parseLabel(text: string) {
  const o = objectOrRefusal(text);
  const per100 = macros(o.per100 ?? o);
  if (!per100 || per100.kcal <= 0) throw new Error('label: no energy value');
  if (per100.kcal > 950 || per100.protein_g + per100.carbs_g + per100.fat_g > 105) throw new Error('label: impossible per-100 g values');
  return {
    mode: 'label' as const, per100,
    source: o.source === 'recognized' ? 'recognized' : 'label',
    name: typeof o.name === 'string' && o.name.trim() && o.name !== 'null' ? o.name.trim().slice(0, 120) : null,
    serving_g: n(o.serving_g), package_g: n(o.package_g),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const refused = await gate(req, 'ai');
  if (refused) return refused;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON.' }, 400); }
  const label = body?.mode === 'label';
  const desc = typeof body?.description === 'string' ? body.description.trim().slice(0, 600) : '';
  const image = imageFrom(body?.image);
  if (!image && !desc) return json({ error: 'Describe the food, add a photo, or both.' }, 400);
  if (label && !image) return json({ error: 'Reading a label needs a photo of it.' }, 400);

  // Which engines may answer: _shared/auth.ts providersFor. A photo never goes
  // to a free text gateway; with no engine for it, it waits.
  const only = providersFor(req, image ? 'private' : 'text', body?.only);
  if (image && !only.length) {
    return json({ error: 'Reading photos is paused for now. Type what you ate, or the numbers from the label, and it logs the same way.', paused: true });
  }
  const started = Date.now();
  try {
    const { value, provider } = label
      ? await ask({ prompt: LABEL_PROMPT, image }, parseLabel, { only })
      : await ask({ prompt: mealPrompt(desc, !!image), image }, parseMeal, { only });
    return json({ ...value, provider, ms: Date.now() - started });
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.message });
    console.error('estimate-food failed', JSON.stringify((e as any)?.errors ?? String(e)));
    // Only Gemini reads photos. With its prepaid credit used up, "try again"
    // would be untrue: say it's paused, and that words still work.
    if (image && outOfCredit(e)) {
      return json({ error: 'Reading photos is paused for now. Type what you ate, or the numbers from the label, and it logs the same way.', paused: true, ms: Date.now() - started });
    }
    // 200 with an error body: the client shows it and runs its own fallbacks.
    return json({ error: 'Every food-estimate service is busy or down right now.', ms: Date.now() - started });
  }
});
