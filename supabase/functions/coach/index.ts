// coach — the AI behind Slim Chance's evening message, its one "noticed" line and
// its notes on what it has learned about the person. The app sends the day's
// facts, built from its own stores (src/lib/brain.ts buildFacts); this writes
// the reply, and the app checks every reply before a word of it is shown
// (checkReply there). Nothing here computes a number about the person.
//
// Gemini only: two weeks of someone's weight, food and plans are too personal
// for a free gateway whose data handling we can't check. Until Gemini runs on
// its paid tier (GEMINI_TIER=paid; Google's terms require it for apps used in
// the EU) only the owner's account (OWNER_USER_ID) may use it.
//
//   POST {"facts": {...}}  ->  {"reply": {...}, "provider": "...", "ms": n}
//   POST {"mode": "plan", "facts": {...}}  ->  the same envelope, the reply a
//     plan of foods and grams for the next days (src/lib/mealPlan.ts checks it
//     and works out every number itself).

import { ask, corsHeaders, extractJson, GEMINI_PAID, json } from '../_shared/llm.ts';
import { gate } from '../_shared/auth.ts';

// Comma-separated, so a throwaway test account can be let in for a live check.
const OWNERS = (Deno.env.get('OWNER_USER_ID') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    send_evening: { type: 'BOOLEAN' },
    evening_title: { type: 'STRING' },
    evening_body: { type: 'STRING' },
    noticed_title: { type: 'STRING' },
    noticed_body: { type: 'STRING' },
    notes: { type: 'STRING' },
  },
  required: ['send_evening', 'evening_title', 'evening_body', 'noticed_title', 'noticed_body', 'notes'],
};

function prompt(facts: unknown): string {
  return `You are the coach inside Slim Chance, an app for one person losing weight on their own. Each afternoon you decide what the app says to them tonight, and you get to know them over time.

Rules, always:
- Use only the facts below. Every number you write must appear in the facts; you may count days in the table.
- Calm, plain, specific and warm; dry rather than bubbly, and never a joke at their expense. A coach, not a cheerleader. Talk in trends and likelihoods, never promises. Never shame, never mention streaks, never use guilt. A slip is one meal, not a ruined week.
- Their rhythm is theirs: never judge meal times, fasting or eating late.
- Budget left is room, not a target. Never tell them to eat what's left.
- If today.trained is true, training is done: never remind them about it.
- Never ask them to log more, log more completely, or log on more days. The app's budget is built to work with however they log, gaps included; a gap is something you note, never something you ask them to fix.
- No medical advice. Pain goes to their program's own rules.
- Write in their units (facts.units) and their language, the way a friend who knows their numbers would say it: not like a calendar, never reading a schedule label back word for word.
- When you name a weekday next to a date, take it from that row's dow.

1. The evening message: title at most 50 characters, body at most 240. Decide whether tonight needs one. Send one only if it could change something tonight: a session still ahead and not done; protein well short when their usual foods could close it; a Friday or weekend pull, using their own plan; or something new and useful from the last two weeks. If nothing would change, set send_evening to false and leave the two fields empty. Never repeat or closely echo any of recentEvenings, and vary how you open. Use their own words from plans or why when it fits, briefly.
2. Noticed (optional): one pattern in their weight, food or training from the 14 days that's worth knowing, with its evidence (dates or numbers from the table) and one small thing to try that isn't about logging. Title at most 50 characters, body at most 300. Empty strings when nothing stands out.
3. Notes, at most 120 words: what you have learned about this person, their habits, what they respond to and what they ignore. Keep what still holds from the previous notes (facts.notes). Facts, not judgments. No names.

Facts (JSON):
${JSON.stringify(facts)}

Reply with JSON only: {"send_evening":true|false,"evening_title":"...","evening_body":"...","noticed_title":"...","noticed_body":"...","notes":"..."}`;
}

const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    days: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING' },
          meals: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                time: { type: 'STRING' },
                items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { food: { type: 'STRING' }, grams: { type: 'NUMBER' } }, required: ['food', 'grams'] } },
              },
              required: ['time', 'items'],
            },
          },
        },
        required: ['date', 'meals'],
      },
    },
    note: { type: 'STRING' },
  },
  required: ['days', 'note'],
};

function planPrompt(facts: any): string {
  return `You are the coach inside Slim Chance, an app for one person losing weight on their own. They asked you what to eat on the next days of their week. Plan each day in facts.days.
Rules, always:
- Use only foods from facts.foods, by their exact name, each with grams. Values there are per 100 g. The app adds up calories and protein itself.
- Each day comes to between facts.floorKcal and facts.dayKcal calories; aim close to facts.dayKcal. Never go under facts.floorKcal: a hard day to pay back an earlier one is not allowed, however far over the week they are.
- At least facts.proteinTargetG grams of protein each day.
- Their rhythm is theirs: if facts.notes say when they eat (a fast until the afternoon, a late snack), plan the meals at those times. Never judge meal times or fasting.
- Plain food anyone can buy at a supermarket and cook in a few minutes. Repeat foods across days when that's simpler. Two to four meals a day, each with a time as HH:MM.
- facts.problem, when present, is why the app refused your last plan: fix that.
- note: one or two plain, warm sentences for them, with no numbers in it. No medical advice; never shame.
Facts (JSON):
${JSON.stringify(facts)}
Reply with JSON only: {"days":[{"date":"YYYY-MM-DD","meals":[{"time":"HH:MM","items":[{"food":"exact name from facts.foods","grams":0}]}]}],"note":"..."}`;
}

function parsePlan(text: string) {
  const o = extractJson(text);
  if (!o || !Array.isArray(o.days)) throw new Error('no plan in the answer');
  return o;
}

/** The user behind the token. The gateway has already verified it (verify_jwt). */
function subOf(req: Request): string | null {
  try {
    const part = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null;
  } catch {
    return null;
  }
}

function parse(text: string) {
  const o = extractJson(text);
  if (!o || typeof o.send_evening !== 'boolean') throw new Error('no reply in the answer');
  return o;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const refused = await gate(req, 'ai');
  if (refused) return refused;
  if (!GEMINI_PAID && !OWNERS.includes(subOf(req) ?? '')) {
    return json({ error: "The AI coach starts once Slim Chance's AI runs on its paid tier." }, 503);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Send JSON.' }, 400); }
  const facts = body?.facts;
  if (!facts || typeof facts !== 'object' || JSON.stringify(facts).length > 20_000) return json({ error: 'Send the day\'s facts.' }, 400);

  const started = Date.now();
  const planning = body?.mode === 'plan';
  try {
    const { value, provider } = await ask(
      planning
        ? { prompt: planPrompt(facts), schema: PLAN_SCHEMA, temperature: 0.4, timeoutMs: 30_000 }
        : { prompt: prompt(facts), schema: SCHEMA, temperature: 0.6, timeoutMs: 25_000 },
      planning ? parsePlan : parse,
      { only: ['gemini'], deadlineMs: 40_000 },
    );
    return json({ reply: value, provider, ms: Date.now() - started });
  } catch (e) {
    console.error('coach failed', JSON.stringify((e as any)?.errors ?? String(e)));
    return json({ error: 'The coach is busy right now.', ms: Date.now() - started });
  }
});
