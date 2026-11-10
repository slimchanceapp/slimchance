// One LLM call path for every AI feature (estimate-food, estimate-bf,
// generate-recipe), free providers only, hedged so that one slow, rate-limited
// or retired provider costs seconds instead of the feature:
//
//   1. Gemini (our key)  best quality; fast models with thinking minimised
//   2. Kilo gateway      keyless free tier — other companies' models; text only
//   3. Pollinations      keyless; text only
//
// Photos go to Gemini alone (decided 2026-10-18): a food or body photo is too
// personal to send through a free gateway whose data handling we can't check.
// When every Gemini model is busy, a photo estimate fails; the app keeps the
// photo for another try, and words work with every provider.
//
// WHY (2026-10-16): each function called ONE hardcoded Gemini model with no
// timeout. Measured from this project's edge runtime that day,
// gemini-flash-latest did not answer a one-word prompt in 25 s, flash-lite took
// 22 s, and gemini-2.5-flash had been retired (404). Food estimates hung for
// minutes, recipes hung, and the body-fat estimate had been dead outright.
//
// Providers are HEDGED, not queued: when the current one hasn't answered within
// `staggerMs`, the next starts in parallel; the first answer that passes the
// caller's `parse` wins and cancels the rest. A provider that fails fast hands
// over immediately.

// globalThis lookup so scripts/selfcheck.js (Node) can import the pure parts.
const GEMINI_KEY: string = (globalThis as any).Deno?.env.get('GEMINI_API_KEY') ?? '';
// Ordered by measured latency with thinking minimised (~1.5 s each). A model
// that 404s is skipped; if every one is gone the live model list is consulted,
// so a retirement degrades to "a different flash model", not an outage.
const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
const KILO_URL = 'https://api.kilo.ai/api/gateway/chat/completions';
// Measured on a Slovak dish: beam-free 3 s, kilo-auto 7 s, nemotron-super 6.5 s.
// Free model lists churn; a dead one fails fast (404/429) and the next is tried.
const KILO_TEXT = ['reflection/beam-free', 'kilo-auto/free', 'nvidia/nemotron-3-super-120b-a12b:free'];
const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** The model looked and gave a reasoned "no" (no food in the photo, …). Final:
 *  it ends the race instead of failing over to a provider that might guess. */
export class Refusal extends Error {}

/** Gemini answered "HTTP 402: prepayment credits are depleted". Every Gemini
 *  model draws on the same prepaid balance, so nothing on Gemini works until
 *  the owner tops it up; photos have no other reader (2026-11-10: the balance
 *  ran out and the app said "try again in a minute"). */
export const outOfCredit = (e: unknown): boolean =>
  (((e as any)?.errors ?? []) as unknown[]).some((m) => /gemini[\w.-]*: HTTP 402/i.test(String(m)));

/** A one-token look at the prepaid balance, for the daily health digest. */
export async function geminiCredit(): Promise<'ok' | 'out of credit' | 'unknown'> {
  if (!GEMINI_KEY) return 'unknown';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with: ok' }] }], generationConfig: { maxOutputTokens: 1 } }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.status === 402 ? 'out of credit' : res.ok ? 'ok' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export type Image = { mime: string; data: string };
export const imageFrom = (v: unknown): Image | undefined => {
  const m = typeof v === 'string' ? v.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s) : null;
  return m ? { mime: m[1], data: m[2] } : undefined;
};

/** Last balanced {...} in the text that parses as JSON. Free models wrap their
 *  answer in fences, prose, or their own visible reasoning; the answer is last. */
export function extractJson(text: string): Record<string, unknown> | null {
  for (let end = text.lastIndexOf('}'); end > 0; end = text.lastIndexOf('}', end - 1)) {
    let depth = 0, inStr = false;
    for (let i = end; i >= 0; i--) {
      const ch = text[i];
      if (inStr) { if (ch === '"' && text[i - 1] !== '\\') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '}') depth++;
      else if (ch === '{' && --depth === 0) {
        try {
          const v = JSON.parse(text.slice(i, end + 1));
          if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch { /* not this one */ }
        break;
      }
    }
  }
  return null;
}

export type Ask = {
  prompt: string;
  image?: Image;
  /** Gemini responseSchema; other providers get only the prompt, so the prompt
   *  must describe the JSON shape too. */
  schema?: unknown;
  temperature?: number;
  /** Per-attempt timeout; defaults 12 s text / 20 s image (Gemini) and +8 s elsewhere. */
  timeoutMs?: number;
};
export type Options = { only?: unknown[] | null; staggerMs?: number; deadlineMs?: number };
type Provider = { name: string; vision: boolean; run: <T>(a: Ask, parse: (t: string) => T, s: AbortSignal) => Promise<{ value: T; provider: string }> };

const withTimeout = (s: AbortSignal, ms: number) => AbortSignal.any([s, AbortSignal.timeout(ms)]);
// Never let an upstream message carry a credential back to a client. Google's
// keys were AIza…; AI Studio has issued AQ.… auth keys since mid-2026.
const scrub = (s: string) => s.replace(/AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_.-]{20,}/g, '[key]').slice(0, 200);

let geminiModels = GEMINI_MODELS;
let rediscovered = false;

function geminiCall(model: string, a: Ask, thinking: 'minimal' | 'low', signal: AbortSignal) {
  const parts: unknown[] = [{ text: a.prompt }];
  if (a.image) parts.push({ inlineData: { mimeType: a.image.mime, data: a.image.data } });
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    // Key in a header, never the URL: fetch errors echo the URL, and the old code
    // forwarded those messages to the client.
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        ...(a.schema ? { responseSchema: a.schema } : {}),
        temperature: a.temperature ?? 0.2,
        thinkingConfig: { thinkingLevel: thinking },
      },
    }),
    signal: withTimeout(signal, a.timeoutMs ?? (a.image ? 20_000 : 12_000)),
  });
}

/** Every configured model 404'd: ask the API which flash models exist now and
 *  use those, newest first. Once per isolate. */
async function rediscover() {
  rediscovered = true;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': GEMINI_KEY }, signal: AbortSignal.timeout(5000),
    });
    const names: string[] = ((await r.json())?.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace('models/', ''))
      .filter((m: string) => /^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(m))
      .sort((a: string, b: string) => parseFloat(b.slice(7)) - parseFloat(a.slice(7)));
    if (names.length) geminiModels = names.slice(0, 4);
  } catch { /* keep the old list; the other providers still run */ }
}

/** Try `models` in turn. Every model's failure is kept: the log used to show
 *  only the last one, which hid what the others had done. */
async function geminiRun<T>(models: string[], a: Ask, parse: (t: string) => T, signal: AbortSignal) {
  if (!GEMINI_KEY) throw new Error('gemini: no key');
  const fails: string[] = [];
  for (const model of models) {
    try {
      let res = await geminiCall(model, a, 'minimal', signal);
      let body = await res.json().catch(() => ({}));
      // Some models (gemini-flash-latest) reject 'minimal'; 'low' is the floor there.
      if (res.status === 400 && /thinking/i.test(body?.error?.message ?? '')) {
        res = await geminiCall(model, a, 'low', signal);
        body = await res.json().catch(() => ({}));
      }
      if (!res.ok) {
        fails.push(`${model}: HTTP ${res.status} ${scrub(body?.error?.message ?? '')}`);
        if (res.status === 404 && model === geminiModels.at(-1) && !rediscovered) await rediscover();
        continue;
      }
      const text = (body?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
      return { value: parse(text), provider: model };
    } catch (e) {
      if (e instanceof Refusal || signal.aborted) throw e;
      fails.push(`${model}: ${scrub(String((e as Error)?.message ?? e))}`);
    }
  }
  throw new Error(fails.join(' | ') || 'gemini: no model answered');
}

const gemini: Provider = { name: 'gemini', vision: true, run: (a, parse, signal) => geminiRun(geminiModels, a, parse, signal) };
// A photo has no provider but Gemini, so its models race instead of queueing:
// a stuck or overloaded model then costs one stagger, not the whole deadline.
// (2026-10-20: three photos in a row failed, the first on HTTP 503 "high
// demand", the next two waiting out 20 s timeouts one model after another.)
const geminiModel = (model: string): Provider => ({ name: 'gemini', vision: true, run: (a, parse, signal) => geminiRun([model], a, parse, signal) });

function openAiCompatible(name: string, url: string, vision: boolean, models: (a: Ask) => string[], extra: Record<string, unknown> = {}): Provider {
  return {
    name, vision,
    async run(a, parse, signal) {
      let last = `${name}: no model answered`;
      for (const model of models(a)) {
        try {
          const content = a.image
            ? [{ type: 'text', text: a.prompt }, { type: 'image_url', image_url: { url: `data:${a.image.mime};base64,${a.image.data}` } }]
            : a.prompt;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: a.temperature ?? 0.2, ...extra }),
            signal: withTimeout(signal, (a.timeoutMs ?? (a.image ? 20_000 : 12_000)) + 8_000),
          });
          const body = await res.json().catch(() => ({}));
          const text = body?.choices?.[0]?.message?.content;
          if (!res.ok || typeof text !== 'string') {
            last = `${name}/${model}: HTTP ${res.status} ${scrub(JSON.stringify(body?.error ?? '').slice(0, 120))}`;
            continue;
          }
          return { value: parse(text), provider: `${name}:${model}` };
        } catch (e) {
          if (e instanceof Refusal || signal.aborted) throw e;
          last = `${name}/${model}: ${scrub(String((e as Error)?.message ?? e))}`;
        }
      }
      throw new Error(last);
    },
  };
}

const PROVIDERS: Provider[] = [
  gemini,
  openAiCompatible('kilo', KILO_URL, false, () => KILO_TEXT),
  // Its anonymous model reasons before answering and the tier caps output, so a
  // long answer (a recipe) came back empty with finish_reason "length" until
  // reasoning was turned down. (max_tokens is a paid feature: HTTP 402.)
  openAiCompatible('pollinations', POLLINATIONS_URL, false, () => ['openai'], { reasoning_effort: 'low' }),
];

/**
 * Ask every eligible provider, hedged. `parse` turns raw model text into the
 * caller's value: throw an Error to fail over to the next provider, throw a
 * Refusal to end the race with that answer. `only` narrows the chain by
 * provider name so each fallback can be exercised on its own.
 */
/** Google's paid tier is switched on for the key (the GEMINI_TIER=paid secret).
 *  On the free tier Google may use what's sent to improve its products, and
 *  people there may read it; body photos are not sent until this is true. */
export const GEMINI_PAID: boolean = (globalThis as any).Deno?.env.get('GEMINI_TIER') === 'paid';

export function ask<T>(a: Ask, parse: (text: string) => T, opts: Options = {}): Promise<{ value: T; provider: string }> {
  const chain = a.image ? geminiModels.map(geminiModel) : PROVIDERS;
  const providers = chain.filter((p) => (!a.image || p.vision) && (!opts.only || opts.only.includes(p.name)));
  const stagger = opts.staggerMs ?? (a.image ? 9_000 : 6_000);
  const ctrl = new AbortController();
  const errors: string[] = [];
  return new Promise((resolve, reject) => {
    if (!providers.length) return reject(Object.assign(new Error('no provider matches'), { errors }));
    let next = 0, running = 0, done = false, timer: number | undefined;
    const deadline = setTimeout(() => { errors.push(`deadline, ${running} still running`); end(new Error('deadline')); }, opts.deadlineMs ?? 40_000);
    function end(v: { value: T; provider: string } | Error) {
      if (done) return;
      done = true;
      clearTimeout(deadline); clearTimeout(timer); ctrl.abort();
      if (v instanceof Error) reject(Object.assign(v, { errors })); else resolve(v);
    }
    function launch() {
      clearTimeout(timer);
      if (done || next >= providers.length) return;
      const p = providers[next++];
      running++;
      p.run(a, parse, ctrl.signal).then(end, (e) => {
        running--;
        if (e instanceof Refusal) return end(e);
        errors.push(String(e?.message ?? e));
        if (next < providers.length) launch();
        else if (running === 0) end(new Error('all providers failed'));
      });
      timer = setTimeout(launch, stagger);
    }
    launch();
  });
}
