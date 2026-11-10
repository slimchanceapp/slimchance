// Generate a recipe on demand, to the user's own spec.
//
// WHY THIS EXISTS: the app shipped a hardcoded array of 19 recipes in
// src/lib/data/recipes.ts. But the app is online by definition (the APK is a
// thin shell that loads the live site), so a frozen list was never a technical
// constraint — it just meant the same 19 meals forever, none of which adapt to
// what's in your fridge, how much time you have tonight, or the protein you
// still need to hit today. This returns a fresh recipe built around the user's
// ACTUAL macro gap and constraints, in the EXACT same shape as the static
// recipes, so it renders through the existing recipe modal with no UI rework.
//
// Providers come from ../_shared/llm.ts: it called gemini-flash-latest alone,
// with no timeout, and that model was taking 25 s+ to say "ok" (2026-10-16).
import { ask, corsHeaders, extractJson, json } from '../_shared/llm.ts';
import { gate, providersFor } from '../_shared/auth.ts';

// Asking for structured output natively is far more reliable than begging for
// JSON in the prompt and then stripping code fences off the answer.
const RECIPE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    e: { type: 'STRING', description: 'A single emoji representing the dish' },
    t: { type: 'INTEGER', description: 'Total time in minutes' },
    k: { type: 'INTEGER', description: 'kcal PER PORTION' },
    p: { type: 'INTEGER', description: 'protein grams PER PORTION' },
    c: { type: 'INTEGER', description: 'carb grams PER PORTION' },
    f: { type: 'INTEGER', description: 'fat grams PER PORTION' },
    batch: { type: 'INTEGER', description: 'How many portions the recipe makes' },
    desc: { type: 'STRING', description: 'One appetising sentence' },
    ing: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'STRING', description: 'Ingredient name' },
          a: { type: 'STRING', description: 'Amount for the WHOLE batch, e.g. "800g"' },
          cat: { type: 'STRING', description: 'One of: protein, veg, dairy, dry' },
        },
        required: ['n', 'a', 'cat'],
      },
    },
    prep: { type: 'ARRAY', items: { type: 'STRING' } },
    steps: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Stovetop/oven method' },
    instantPot: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Instant Pot method' },
    kid: { type: 'BOOLEAN' },
    coachNote: {
      type: 'STRING',
      description: 'One sentence on how this fits the stated macro goal',
    },
  },
  required: ['name', 'e', 't', 'k', 'p', 'c', 'f', 'batch', 'desc', 'ing', 'prep', 'steps', 'instantPot'],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }
  const refused = await gate(req, 'ai');
  if (refused) return refused;

  try {
    const body = await req.json();
    const request = typeof body.request === 'string' ? body.request.trim() : '';
    const proteinTarget = Number(body.proteinTarget) || null;
    const kcalTarget = Number(body.kcalTarget) || null;
    const proteinSoFar = Number(body.proteinSoFar) || 0;
    const kcalSoFar = Number(body.kcalSoFar) || 0;
    const avoid: string[] = Array.isArray(body.avoid) ? body.avoid.slice(0, 40) : [];

    if (!request) {
      return new Response(JSON.stringify({ error: 'Tell me what you feel like eating.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The macro gap is the whole point: a recipe that ignores what you've
    // already eaten today is just a recipe, not a coach.
    const gapLines: string[] = [];
    if (proteinTarget) {
      const gap = Math.max(0, Math.round(proteinTarget - proteinSoFar));
      gapLines.push(
        `The user still needs about ${gap}g of protein today (target ${proteinTarget}g, ${Math.round(proteinSoFar)}g eaten). Design the portion so ONE serving makes a serious dent in that gap.`
      );
    }
    if (kcalTarget && body.direction !== 'gain') {
      const gap = Math.round(kcalTarget - kcalSoFar);
      gapLines.push(
        gap > 0
          ? `They have about ${gap} kcal left in today's budget (target ${kcalTarget}, ${Math.round(kcalSoFar)} eaten). A single portion must fit comfortably inside that.`
          : `They have already met today's ${kcalTarget} kcal budget, so keep the portion genuinely light.`
      );
    }

    // Not everyone is cutting (see the 5bd4f55 safety fix): someone recovering
    // from illness or building up must not be handed "diet food".
    const direction = ['cut', 'maintain', 'gain'].includes(body.direction) ? body.direction : 'cut';
    const who = direction === 'gain'
      ? 'someone who lifts weights and needs to GAIN weight — energy-dense, high protein, easy to eat a full portion of'
      : direction === 'maintain'
        ? 'someone who lifts weights and is holding their weight — balanced, high protein, satisfying'
        : 'someone in a calorie deficit who lifts weights — high protein, high satiety, real food, genuinely delicious. Not diet food';

    const prompt = `You are a body-recomposition chef. Create ONE recipe for ${who}.

WHAT THEY ASKED FOR: "${request}"

${gapLines.join('\n')}

Reply with JSON only, in this shape:
{"name":"","e":"<one emoji>","t":<total minutes>,"k":<kcal per portion>,"p":<protein g per portion>,"c":<carb g per portion>,"f":<fat g per portion>,"batch":<portions>,"desc":"<one appetising sentence>","ing":[{"n":"<ingredient>","a":"<amount for the whole batch>","cat":"protein|veg|dairy|dry"}],"prep":["..."],"steps":["..."],"instantPot":["..."],"kid":<true|false>,"coachNote":"<one sentence>"}

HARD RULES:
- Macros (k, p, c, f) are PER PORTION, not for the whole batch. They must be arithmetically consistent with the ingredients divided by "batch". Protein should be a high share of calories.
- "ing" amounts are for the WHOLE batch. Every ingredient's "cat" must be exactly one of: protein, veg, dairy, dry.
- Give BOTH methods: "steps" (stovetop/oven) and "instantPot" (pressure cooker). If the dish genuinely cannot be pressure-cooked, use the instantPot array to explain how to adapt it using SAUTÉ mode instead — never leave it empty.
- "prep" is the mise-en-place done before cooking starts.
- Steps must be specific and followable: real times, real temperatures, real pan sizes. "Cook until done" is useless.
- Respect any allergy, dislike, equipment or time constraint stated in the request.
${avoid.length ? `- They have recently eaten these, so make it clearly different: ${avoid.join(', ')}.` : ''}
- Set "kid": true only if a small child would happily eat it.
- "coachNote": one sentence on how this serves their goal.`;

    let parsed: any;
    try {
      ({ value: parsed } = await ask(
        { prompt, schema: RECIPE_SCHEMA, temperature: 1.0, timeoutMs: 45_000 },
        (text) => {
          const o = extractJson(text) as Record<string, any> | null;
          if (!o || !o.name || !Array.isArray(o.ing) || !Array.isArray(o.steps) || !o.steps.length) throw new Error('incomplete recipe');
          return o;
        },
        { only: providersFor(req, 'text', body?.only), staggerMs: 15_000, deadlineMs: 100_000 },
      ));
    } catch (e) {
      console.error('generate-recipe failed', JSON.stringify((e as any)?.errors ?? String(e)));
      return json({ error: 'Every recipe service is busy or down right now — try again in a minute.' });
    }

    const num = (v: unknown, fallback = 0) => {
      const n = Number(v);
      return isFinite(n) && n >= 0 ? Math.round(n) : fallback;
    };
    const strArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

    // Normalise to exactly the shape src/lib/data/recipes.ts uses, so the
    // existing recipe card + modal render it with no special-casing.
    const CATS = new Set(['protein', 'veg', 'dairy', 'dry']);
    const recipe = {
      name: String(parsed.name || 'Untitled recipe'),
      e: String(parsed.e || '🍽️').slice(0, 4),
      t: num(parsed.t, 30),
      k: num(parsed.k),
      p: num(parsed.p),
      c: num(parsed.c),
      f: num(parsed.f),
      batch: Math.max(1, num(parsed.batch, 1)),
      desc: String(parsed.desc || ''),
      ing: (Array.isArray(parsed.ing) ? parsed.ing : []).map((i: any) => ({
        n: String(i?.n || ''),
        a: String(i?.a || ''),
        // Anything unexpected lands in "dry" — the modal groups by category and
        // would silently drop an ingredient with an unknown one.
        cat: CATS.has(String(i?.cat)) ? String(i.cat) : 'dry',
        pr: 0,
      })).filter((i: any) => i.n),
      prep: strArray(parsed.prep),
      steps: strArray(parsed.steps),
      instantPot: strArray(parsed.instantPot),
      kid: parsed.kid === true,
      coachNote: String(parsed.coachNote || ''),
    };

    if (!recipe.ing.length || !recipe.steps.length) {
      return new Response(
        JSON.stringify({ error: 'That came back incomplete. Try again with a bit more detail.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(recipe), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
