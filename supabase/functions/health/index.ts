// GET with the x-health-token header: the live app's last 24 hours in totals.
// New kinds of error, sign-ups and finished setups, reminders that couldn't
// be set, AI calls. Nothing about any one person. Read once a day by
// .github/workflows/health-digest.yml, which emails the owner when something
// new needs a look. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by
// the platform; HEALTH_TOKEN is a project secret. A wrong token sees nothing.
import { ENGINES, geminiCredit } from '../_shared/llm.ts';

const BASE = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TOKEN = Deno.env.get('HEALTH_TOKEN') ?? '';

async function rest(path: string): Promise<any[]> {
  const r = await fetch(`${BASE}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status}`);
  return r.json();
}

Deno.serve(async (req) => {
  if (!TOKEN || req.headers.get('x-health-token') !== TOKEN) return new Response('Not found', { status: 404 });
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  try {
    const [errors, events, ai, credit] = await Promise.all([
      rest(`client_errors?select=fingerprint,message,kind,route,user_id&last_seen=gte.${since}`),
      rest(`app_events?select=event,user_id&at=gte.${since}`),
      rest(`ai_usage_global?select=bucket,calls&day=gte.${since.slice(0, 10)}`),
      geminiCredit(),
    ]);
    // A kind of error is new when nobody had it before this window.
    const prints = [...new Set(errors.map((e) => e.fingerprint))];
    const older = prints.length
      ? new Set((await rest(`client_errors?select=fingerprint&first_seen=lt.${since}&fingerprint=in.(${prints.map((p) => `"${p}"`).join(',')})`)).map((e) => e.fingerprint))
      : new Set();
    const byPrint = new Map<string, { message: string; kind: string; route: string; people: Set<string> }>();
    for (const e of errors) {
      const p = byPrint.get(e.fingerprint) ?? { message: String(e.message ?? '').slice(0, 160), kind: e.kind ?? '', route: e.route ?? '', people: new Set() };
      p.people.add(e.user_id);
      byPrint.set(e.fingerprint, p);
    }
    const errorsOut = [...byPrint].map(([fp, p]) => ({ new: !older.has(fp), message: p.message, kind: p.kind, route: p.route, people: p.people.size }));
    const people: Record<string, Set<string>> = {};
    for (const e of events) (people[e.event] ??= new Set()).add(e.user_id);
    const aiOut: Record<string, number> = {};
    for (const a of ai) aiOut[a.bucket] = (aiOut[a.bucket] ?? 0) + (a.calls ?? 0);
    return Response.json({
      since,
      errors: errorsOut.sort((a, b) => Number(b.new) - Number(a.new) || b.people - a.people),
      events: Object.fromEntries(Object.entries(people).map(([k, v]) => [k, v.size])),
      ai: aiOut,
      // Gemini's prepaid balance, checked with one token: photos, labels and
      // the coach stop when it runs out (2026-11-10).
      ai_credit: credit,
      engines: ENGINES,
    });
  } catch (e) {
    return Response.json({ since, failed: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
