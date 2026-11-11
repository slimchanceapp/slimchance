// FOOD LOGIC — pure, no I/O, covered by scripts/selfcheck.js.
//
// One logger answers every way of saying what you ate: your own history, the
// built-in generic foods ($lib/data/foods), Open Food Facts products, and — as
// the offline last resort when every AI service is unreachable — an estimate
// built from those same sources by reading quantities out of the description.

import { BASE_FOODS, type BaseFood } from './data/foods.ts';

export type Macros = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
export type Serving = { label: string; g: number };

/** One row the logger can offer. */
export interface Candidate {
  key: string;
  source: 'history' | 'builtin' | 'off' | 'usda';
  name: string;
  brand?: string;
  /** Per 100 g (100 ml for drinks) when known. */
  per100: Macros | null;
  /** History: the exact portion last logged, with its grams if recorded. */
  portion?: (Macros & { grams: number | null }) | null;
  servings: Serving[];
  ml?: boolean;
  /** History: times logged, last date, and whether the latest was an AI guess. */
  count?: number;
  lastDate?: string;
  ai?: boolean;
  barcode?: string | null;
  /** OFF: sold in Slovakia or Czechia. */
  local?: boolean;
}

/** What the logger hands the page to save — one food_logs row minus ids/dates. */
export type NewFood = Macros & { name: string; grams?: number | null; barcode?: string | null; source: string };

/** A food_logs row, loosely typed — this module takes plain rows. */
export interface LogRow {
  name?: string | null; date?: string | null; created_at?: string | null;
  kcal?: number | string | null; protein_g?: number | string | null; carbs_g?: number | string | null; fat_g?: number | string | null;
  grams?: number | string | null; barcode?: string | null; source?: string | null;
}

const num = (v: unknown): number => {
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

export const fold = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const words = (s: string): string[] => fold(s).split(/[^\p{L}\p{N}%]+/u).filter(Boolean);
// Longest first. Deliberately not "-ok"/"-ka": "rozok" must not stem to "roz" and find raisins.
const CASE_ENDINGS = ['ami', 'ach', 'ou', 'om', 'ov', 'mi', 'ia', 'ie', 'e', 'y', 'i', 'u', 'a'];

/** Legacy rows carried their provenance in the name — "Plain white rice
 *  (cooked) (AI estimate, high confidence)", "Tvaroh (per 100g — adjust
 *  portion)". That suffix split one food into many and hid it from quick add. */
export function cleanName(name: string): string {
  return name
    .replace(/\s*\(AI estimate[^)]*\)\s*$/i, '')
    .replace(/\s*\(per 100 ?g[^)]*\)\s*$/i, '')
    .trim();
}

export function times(m: Macros, k: number): Macros {
  return { kcal: Math.round(m.kcal * k), protein_g: r1(m.protein_g * k), carbs_g: r1(m.carbs_g * k), fat_g: r1(m.fat_g * k) };
}

export const scale = (per100: Macros, grams: number): Macros => times(per100, grams / 100);

export function sum(items: Macros[]): Macros {
  const t = items.reduce((a, m) => ({
    kcal: a.kcal + m.kcal, protein_g: a.protein_g + m.protein_g, carbs_g: a.carbs_g + m.carbs_g, fat_g: a.fat_g + m.fat_g,
  }), { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  return { kcal: Math.round(t.kcal), protein_g: r1(t.protein_g), carbs_g: r1(t.carbs_g), fat_g: r1(t.fat_g) };
}

// ── Matching ───────────────────────────────────────────────────────────────

/** 0..1: how well the query words match a text. Every query word has to land
 *  (whole word 3, word-prefix 2, a Slovak/Czech inflection 1.5, inside a word
 *  1); a word that lands nowhere scores the whole text 0. */
export function matchScore(q: string[], text: string): number {
  if (!q.length) return 0;
  const hay = words(text);
  let total = 0;
  for (const w of q) {
    let best = 0;
    for (const h of hay) {
      if (h === w) { best = 3; break; }
      if (h.startsWith(w)) best = Math.max(best, 2);
      else if (w.length >= 3 && h.includes(w)) best = Math.max(best, 1);
    }
    // Inflected forms: "s maslom", "so šunkou", "s ryžou" must still find
    // maslo, šunka, ryža — strip a Slovak/Czech case ending and try the stem.
    if (!best && w.length >= 4) {
      const end = CASE_ENDINGS.find((e) => w.endsWith(e) && w.length - e.length >= 3);
      const stem = end ? w.slice(0, -end.length) : '';
      if (stem && hay.some((h) => h.length > stem.length && h.startsWith(stem))) best = 1.5;
    }
    if (!best) return 0;
    total += best;
  }
  return total / (3 * q.length);
}

function baseScore(q: string[], f: BaseFood): number {
  const joined = q.join(' ');
  // An exact alias ("chicken breast", "rožok") beats a looser hit on a sibling
  // ("Chicken breast, raw"), and a whole-phrase alias beats word soup.
  if (f.aliases.some((a) => fold(a) === joined)) return 1.2;
  return Math.max(matchScore(q, f.name), ...f.aliases.map((a) => matchScore(q, a)));
}

export function baseCandidate(f: BaseFood): Candidate {
  return {
    key: `b:${f.name}`, source: 'builtin', name: f.name, servings: f.servings,
    per100: { kcal: f.kcal, protein_g: f.protein_g, carbs_g: f.carbs_g, fat_g: f.fat_g },
    ...(f.ml ? { ml: true } : {}),
  };
}

/** Everything you've logged, one entry per food (legacy suffixes folded
 *  together), carrying the LATEST portion — a correction you made last week is
 *  what comes back — and per-100 g values whenever grams were recorded. */
export function historyFoods(logs: LogRow[]): Candidate[] {
  const by = new Map<string, { c: Candidate; at: string }>();
  for (const r of logs) {
    const name = cleanName(String(r.name ?? ''));
    if (!name) continue;
    const id = foodKey(name);
    const at = r.created_at || r.date || '';
    const cur = by.get(id);
    if (cur) {
      cur.c.count = (cur.c.count ?? 0) + 1;
      if (at < cur.at) continue;
    }
    const grams = num(r.grams) > 0 ? num(r.grams) : null;
    const portion = { kcal: num(r.kcal), protein_g: num(r.protein_g), carbs_g: num(r.carbs_g), fat_g: num(r.fat_g), grams };
    const per100 = grams ? times(portion, 100 / grams) : null;
    by.set(id, {
      at,
      c: {
        key: `h:${id}`, source: 'history', name, portion, per100,
        servings: grams ? [{ label: 'last time', g: grams }] : [],
        count: cur?.c.count ?? 1, lastDate: r.date || '',
        ai: sourceOf(r) === 'ai',
        barcode: r.barcode ?? cur?.c.barcode ?? null,
      },
    });
  }
  return [...by.values()]
    .map((v) => v.c)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || (b.lastDate ?? '').localeCompare(a.lastDate ?? '') || a.name.localeCompare(b.name));
}

/** Where a row's numbers came from. Legacy rows said so in their name. */
export function sourceOf(r: LogRow): string | null {
  if (r.source) return r.source;
  const n = String(r.name ?? '');
  return /\(AI estimate/i.test(n) ? 'ai' : /\(per 100 ?g/i.test(n) ? 'off' : null;
}

/** Identity of a food across spellings and legacy suffixes. */
export const foodKey = (name: string): string => fold(cleanName(name));

/** Instant, offline results for a query: your foods first, then the basics. */
export function searchLocal(query: string, history: Candidate[], limits = { mine: 5, basics: 6 }) {
  const q = words(query);
  if (!q.length) return { mine: [] as Candidate[], basics: [] as Candidate[] };
  const mine = history
    .map((c) => ({ c, s: matchScore(q, c.name) }))
    .filter((x) => x.s > 0)
    // Frequency breaks ties: the tvaroh you've logged 11 times beats the one-off.
    .sort((a, b) => (b.s + Math.log2((b.c.count ?? 1) + 1) * 0.04) - (a.s + Math.log2((a.c.count ?? 1) + 1) * 0.04))
    .slice(0, limits.mine)
    .map((x) => x.c);
  const basics = BASE_FOODS
    .map((f) => ({ f, s: baseScore(q, f) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limits.basics)
    .map((x) => baseCandidate(x.f));
  return { mine, basics };
}

// ── Open Food Facts ────────────────────────────────────────────────────────

/** An OFF product (API product or search hit) -> a candidate. The old code
 *  required energy-kcal_100g and silently dropped every EU product that only
 *  printed kJ, and named products "Barcode 590…" when product_name was empty
 *  even though product_name_pl/_de/_cs held the name. */
export function offCandidate(p: Record<string, any>): Candidate | null {
  const name = [p.product_name_sk, p.product_name_cs, p.product_name, p.product_name_en, p.product_name_de,
    p.product_name_pl, p.product_name_hu, p.generic_name].find((s) => typeof s === 'string' && s.trim());
  if (!name || !p.code) return null;
  const nm = p.nutriments ?? {};
  const has = (k: string) => nm[k] != null && Number.isFinite(Number(nm[k]));
  const kj = has('energy-kj_100g') ? num(nm['energy-kj_100g']) : has('energy_100g') ? num(nm.energy_100g) : null;
  let kcal = has('energy-kcal_100g') ? num(nm['energy-kcal_100g']) : kj != null ? kj / 4.184 : null;
  const p100 = num(nm.proteins_100g), c100 = num(nm.carbohydrates_100g), f100 = num(nm.fat_100g);
  if (kcal == null && (has('proteins_100g') || has('carbohydrates_100g') || has('fat_100g'))) kcal = 4 * p100 + 4 * c100 + 9 * f100;
  const brands = Array.isArray(p.brands) ? p.brands : String(p.brands ?? '').split(',');
  const servings: Serving[] = [];
  const serving = num(p.serving_quantity), pack = num(p.product_quantity);
  if (serving > 0) servings.push({ label: 'serving', g: serving });
  if (pack > 0 && pack !== serving && pack <= 3000) servings.push({ label: 'whole pack', g: pack });
  return {
    key: `o:${p.code}`, source: 'off', name: String(name).trim(), brand: String(brands[0] ?? '').trim(),
    barcode: String(p.code),
    per100: kcal != null && kcal <= 950 ? { kcal: Math.round(kcal), protein_g: r1(p100), carbs_g: r1(c100), fat_g: r1(f100) } : null,
    servings,
    local: /en:(slovakia|czech-republic)/.test(JSON.stringify(p.countries_tags ?? '')),
  };
}

/** A USDA FoodData Central branded food: food-search's answer when Open Food
 *  Facts doesn't know a barcode (2026-11-10; most packaged foods sold in the
 *  US). Branded values are per 100 g, or 100 ml for drinks. */
export function usdaCandidate(f: Record<string, any>): Candidate | null {
  const code = String(f.gtinUpc ?? '').trim(), desc = String(f.description ?? '').trim();
  if (!code || !desc) return null;
  const n = new Map<string, number>((f.foodNutrients ?? []).map((x: any) => [String(x.nutrientNumber), num(x.value)]));
  const kcal = n.has('208') ? n.get('208')! : null;
  const unit = String(f.servingSizeUnit ?? '').toLowerCase();
  const ml = /^(ml|mlt)$/.test(unit);
  const servings: Serving[] = [];
  const serving = ml || /^(g|grm)$/.test(unit) ? num(f.servingSize) : 0;
  if (serving > 0) servings.push({ label: 'serving', g: Math.round(serving) });
  const pack = num(String(f.packageWeight ?? '').match(/(\d+(?:\.\d+)?)\s*(?:g|ml)\b/i)?.[1]);
  if (pack > 0 && Math.round(pack) !== Math.round(serving) && pack <= 3000) servings.push({ label: 'whole pack', g: Math.round(pack) });
  return {
    key: `u:${code}`, source: 'usda', name: desc.charAt(0) + desc.slice(1).toLowerCase(),
    brand: String(f.brandName || f.brandOwner || '').trim(), barcode: code,
    per100: kcal != null && kcal <= 950 ? { kcal: Math.round(kcal), protein_g: r1(n.get('203') ?? 0), carbs_g: r1(n.get('205') ?? 0), fat_g: r1(n.get('204') ?? 0) } : null,
    servings, ml, local: false,
  };
}

/** OFF's own ranking is poor ("excelent protein" filtered to Slovakia ranked
 *  smoked tofu first), so results are re-ranked: every word should match,
 *  local products and ones with real nutrition rise, popularity breaks ties. */
export function rankProducts(hits: Record<string, any>[], query: string, limit = 12): Candidate[] {
  const q = words(query);
  const seen = new Set<string>();
  const scored: Array<{ c: Candidate; s: number }> = [];
  for (const h of hits) {
    const c = offCandidate(h);
    if (!c || seen.has(c.key)) continue;
    seen.add(c.key);
    const m = matchScore(q, `${c.name} ${c.brand ?? ''}`);
    if (!m) continue;
    scored.push({ c, s: m * 100 + (c.local ? 15 : 0) + (c.per100 ? 10 : -40) + Math.min(10, Math.log2(num(h.unique_scans_n) + 1) * 2) });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.c);
}

// ── Quantities & the offline estimator ─────────────────────────────────────

const UNIT_G: Record<string, number> = { g: 1, gr: 1, gram: 1, gramov: 1, gramy: 1, gramu: 1, grams: 1, kg: 1000, ml: 1, l: 1000, dl: 100, cl: 10 };
const COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, half: 0.5,
  jeden: 1, jedna: 1, jedno: 1, dva: 2, dve: 2, dvě: 2, tri: 3, tři: 3, styri: 4, štyri: 4, čtyři: 4, pol: 0.5, pul: 0.5, půl: 0.5,
};

export type Quantity = { grams: number | null; count: number | null; rest: string };

/** "200g ryža" · "ryža 200 g" · "kofola 0,5l" · "2 rožky" · "2x vajce" · "pol pizze" */
export function parseQuantity(text: string): Quantity {
  const t = text.trim().replace(/(\d),(\d)/g, '$1.$2');
  const unit = '(kg|gr|gramov|gramy|gramu|grams|gram|g|ml|dl|cl|l)\\b\\.?';
  let m = t.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${unit}\\s*(.*)$`, 'i'));
  if (m) return { grams: parseFloat(m[1]) * UNIT_G[m[2].toLowerCase()], count: null, rest: m[3].trim() };
  m = t.match(new RegExp(`^(.*?)\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}$`, 'i'));
  if (m && m[1]) return { grams: parseFloat(m[2]) * UNIT_G[m[3].toLowerCase()], count: null, rest: m[1].trim() };
  m = t.match(/^(\d+(?:\.\d+)?)\s*(?:x|×|ks|kusy|kusov|pcs|pieces)?\s+(.+)$/i);
  if (m) return { grams: null, count: parseFloat(m[1]), rest: m[2].trim() };
  m = t.match(/^(\S+)\s+(.+)$/);
  const w = m ? fold(m[1]) : '';
  if (m && COUNT_WORDS[w] != null) return { grams: null, count: COUNT_WORDS[w], rest: m[2].trim() };
  return { grams: null, count: null, rest: t };
}

export type EstimateItem = Macros & { name: string; grams: number | null; from: string };
export type LocalEstimate = { items: EstimateItem[]; total: Macros; unmatched: string[] };

/** Split a description into parts: commas, "+", and the joining words of
 *  English, Slovak and Czech ("and/with", "a", "s/so/se"). */
export function splitParts(desc: string): string[] {
  return desc
    .replace(/(\d),(\d)/g, '$1.$2') // "0,5 l" is a decimal, not a list
    .split(/[,;+\n&]|\s(?:and|with|plus|a|s|so|se|aj|i)\s/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/** Pick the best single match for one part, from history then the basics. */
function bestMatch(rest: string, history: Candidate[]): Candidate | null {
  const q = words(rest);
  if (!q.length) return null;
  let best: { c: Candidate; s: number } | null = null;
  for (const c of history) {
    const s = matchScore(q, c.name);
    if (s >= 0.66 && (!best || s > best.s)) best = { c, s: s + 0.05 };
  }
  for (const f of BASE_FOODS) {
    const s = baseScore(q, f);
    if (s >= 0.5 && (!best || s > best.s)) best = { c: baseCandidate(f), s };
  }
  return best?.c ?? null;
}

/**
 * The offline estimate — what "describe a food" falls back to when every AI
 * service is unreachable. It only understands foods it knows, and says which
 * parts it couldn't place instead of guessing.
 */
export function estimateLocally(desc: string, history: Candidate[]): LocalEstimate | null {
  const items: EstimateItem[] = [];
  const unmatched: string[] = [];
  for (const part of splitParts(desc)) {
    const { grams, count, rest } = parseQuantity(part);
    const c = bestMatch(rest, history);
    if (!c) { unmatched.push(part); continue; }
    let g: number | null = grams;
    if (g == null && c.servings[0]) g = (count ?? 1) * c.servings[0].g;
    let m: Macros | null = null;
    if (g != null && c.per100) m = scale(c.per100, g);
    else if (c.portion) m = times(c.portion, count ?? 1);
    if (!m) { unmatched.push(part); continue; }
    items.push({ ...m, name: part, grams: g, from: c.name });
  }
  return items.length ? { items, total: sum(items), unmatched } : null;
}

/** GS1 check digit: EAN-8, UPC-A (12), EAN-13, GTIN-14. A camera misread
 *  almost always fails this, so a bad read never reaches a lookup. */
export function validGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop()!;
  const total = d.reverse().reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (total % 10)) % 10 === check;
}
