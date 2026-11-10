// Where food data comes from — the I/O half of the food logger ($lib/food is
// the pure half). Every call has a deadline and degrades to the next source:
//
//   search    your foods + built-in basics (instant, offline) -> Open Food Facts
//             via the food-search edge function
//   barcode   your own history -> OFF product API -> OFF search by code ->
//             USDA FoodData Central (branded, mostly US), via food-search
//   describe  estimate-food (Gemini -> Kilo -> Pollinations, server side) ->
//             the offline estimator in $lib/food

import { supabase } from '$lib/db/client';
import { rankProducts, offCandidate, usdaCandidate, type Candidate, type Macros } from '$lib/food';

export type AiItem = Macros & { name: string; grams: number | null };
export type AiMeal = Macros & { mode: 'meal'; name: string; items: AiItem[]; confidence: 'low' | 'medium' | 'high'; provider: string };
export type AiLabel = { mode: 'label'; name: string | null; source: 'label' | 'recognized'; per100: Macros; serving_g: number | null; package_g: number | null; provider: string };

const OFF_FIELDS = 'code,product_name,product_name_sk,product_name_cs,product_name_en,product_name_de,product_name_pl,product_name_hu,generic_name,brands,nutriments,serving_quantity,product_quantity,countries_tags';

export async function searchProducts(q: string, signal?: AbortSignal): Promise<{ results: Candidate[]; error?: string }> {
  const { data, error } = await supabase.functions.invoke('food-search', { body: { q }, signal, timeout: 9000 });
  if (error) throw error;
  return { results: rankProducts(data?.hits ?? [], q), error: data?.error };
}

/** A scanned code -> a food, or null when nobody knows it. */
export async function lookupBarcode(code: string, history: Candidate[]): Promise<Candidate | null> {
  // Yours first: a product you've logged before is known even when OFF isn't.
  const mine = history.find((c) => c.barcode === code);
  if (mine) return mine;
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}?fields=${OFF_FIELDS}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      const body = await res.json();
      const c = body?.status === 1 && body.product ? offCandidate({ ...body.product, code }) : null;
      if (c) return c;
    }
  } catch { /* fall through to the search index */ }
  try {
    const { data } = await supabase.functions.invoke('food-search', { body: { code }, timeout: 8000 });
    const hit = data?.hits?.[0];
    return hit ? offCandidate(hit) : data?.usda ? usdaCandidate(data.usda) : null;
  } catch {
    return null;
  }
}

/** Ask the estimate-food edge function. Throws on transport failure or when
 *  every provider was down; returns `{ error }` for a reasoned refusal. */
export async function estimateWithAI(body: { description?: string; image?: string; mode?: 'meal' | 'label' }): Promise<AiMeal | AiLabel | { error: string }> {
  const { data, error } = await supabase.functions.invoke('estimate-food', { body, timeout: 50_000 });
  if (error) throw error;
  if (data?.error && /busy or down/i.test(data.error)) throw new Error(data.error);
  return data;
}
