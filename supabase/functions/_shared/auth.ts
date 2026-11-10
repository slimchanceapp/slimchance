// Only a signed-in user, and only so many calls a day, may spend the AI
// providers' free quota (and Open Food Facts' goodwill). verify_jwt alone isn't
// that: the public anon key is a valid JWT too, and it ships inside the web
// app. One database call checks both: ai_take (migration 20261018180000)
// counts the call for the user behind the token, and an anon key has no user
// (it can't even run the function: 401).
import { GEMINI_PAID, GEMMA_ON, json } from './llm.ts';

// The owner's account(s), comma-separated: OWNER_USER_ID.
const OWNERS = (Deno.env.get('OWNER_USER_ID') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** The user behind the token. The gateway has already verified it (verify_jwt). */
export function subOf(req: Request): string | null {
  try {
    const part = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null;
  } catch {
    return null;
  }
}

/** May this call use Gemini? On the paid tier, anyone. On the free tier only
 *  the owner: Google lets an app serve users in the EU, the UK and Switzerland
 *  from the paid tier only (its terms, effective 2026-03-23), and the owner
 *  chose free over paying (2026-11-10). Everyone else's typed food goes to the
 *  free text services the privacy page names; their photos wait. */
export const geminiFor = (req: Request): boolean => GEMINI_PAID || OWNERS.includes(subOf(req) ?? '');

/** The AI engines this call may use, in the order tried. Gemini where Google
 *  allows it for this person; Gemma (Google's open model, on Cloudflare) for
 *  everyone; the free text gateways only for typed food and recipes, never for
 *  a photo, the coach or anything else personal. A client's `only` (for testing
 *  one engine) can narrow the list, never widen it (2026-11-10). */
export function providersFor(req: Request, kind: 'text' | 'private', clientOnly?: unknown): string[] {
  const all = [...(geminiFor(req) ? ['gemini'] : []), ...(GEMMA_ON ? ['gemma'] : []), ...(kind === 'text' ? ['kilo', 'pollinations'] : [])];
  return Array.isArray(clientOnly) ? all.filter((n) => clientOnly.includes(n)) : all;
}

const TAKE = `${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/ai_take`;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

/** Calls per user per day (UTC). Far above a person's use: the busiest real
 *  day so far had four AI estimates. */
export const DAILY = { ai: 25, search: 400 } as const;

/** null when the call may go ahead, else the response to send instead. Fails
 *  closed: with the database down, the app is down anyway. */
export async function gate(req: Request, bucket: keyof typeof DAILY): Promise<Response | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Sign in to use this.' }, 401);
  try {
    const res = await fetch(TAKE, {
      method: 'POST',
      headers: { Authorization: auth, apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_bucket: bucket, p_limit: DAILY[bucket] }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401 || res.status === 403) return json({ error: 'Sign in to use this.' }, 401);
    if (!res.ok) return json({ error: 'Busy right now. Try again in a moment.' }, 503);
    return (await res.json()) === true ? null : json({ error: 'That’s today’s limit for this; it resets at midnight UTC.' }, 429);
  } catch {
    return json({ error: 'Busy right now. Try again in a moment.' }, 503);
  }
}
