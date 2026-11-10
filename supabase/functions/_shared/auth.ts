// Only a signed-in user, and only so many calls a day, may spend the AI
// providers' free quota (and Open Food Facts' goodwill). verify_jwt alone isn't
// that: the public anon key is a valid JWT too, and it ships inside the web
// app. One database call checks both: ai_take (migration 20261018180000)
// counts the call for the user behind the token, and an anon key has no user
// (it can't even run the function: 401).
import { json } from './llm.ts';

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
