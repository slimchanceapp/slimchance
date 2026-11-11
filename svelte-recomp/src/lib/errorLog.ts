/**
 * Persist client-side errors so they survive a reload.
 *
 * THE GAP: the `notices` store is an in-memory writable. Every error the user
 * ever saw was gone the moment the app reloaded, and none of them reach the
 * server (Supabase logged 478 requests in 40h, all HTTP 200) because these are
 * TypeErrors, failed native-bridge calls and rejected promises inside the
 * WebView. The only available protocol was "screenshot it next time", which
 * loses the first occurrence of every bug by definition.
 *
 * Design constraints, in order of importance:
 *   1. This must NEVER throw. An error reporter that crashes while reporting an
 *      error turns one bug into an unrecoverable app. Every path is guarded.
 *   2. It must not amplify. A render loop can throw thousands of times a
 *      second; a naive implementation would DDoS the database with the app's
 *      own failure. Repeats are collapsed by fingerprint, rate-limited in
 *      memory, and capped per session.
 *   3. It must not become an exfiltration path. Messages are truncated and
 *      stacks are stripped to app frames.
 */
import { supabase } from '$lib/db/client';
import { platform } from '$lib/platform';
// The deployed commit (ship passes APP_VERSION, svelte.config.js names the build with it).
import { version } from '$app/environment';

/** Errors sent to the server this session. Bounds the blast radius of a loop. */
const MAX_PER_SESSION = 25;
/** Don't re-send the same fingerprint more often than this. */
const RESEND_AFTER_MS = 60_000;

let sentCount = 0;
const lastSentAt = new Map<string, number>();

/** djb2 — same cheap stable hash used for the permission key. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Keep only frames from our own bundle. Third-party and inline-eval frames can
 * quote page content, and a full stack from a WebView is mostly noise anyway.
 */
function cleanStack(stack: string | undefined): string | null {
  if (!stack) return null;
  const lines = stack
    .split('\n')
    .filter((l) => l.includes('/_app/') || l.includes('.svelte') || /\bat \w/.test(l))
    .slice(0, 12)
    .map((l) => l.trim().slice(0, 200));
  return lines.length ? lines.join('\n').slice(0, 2000) : null;
}


export type ErrorKind = 'error' | 'unhandledrejection' | 'notice' | 'render';

/**
 * Record one error. Fire-and-forget: never awaited by callers, never throws.
 */
export function recordError(
  message: string,
  opts: { stack?: string; kind?: ErrorKind; route?: string } = {}
): void {
  try {
    const msg = String(message || '').slice(0, 500);
    if (!msg) return;

    const stack = cleanStack(opts.stack);
    // Fingerprint on the message plus the first app frame: the same TypeError
    // from two different call sites is genuinely two different bugs.
    const firstFrame = stack?.split('\n')[0] ?? '';
    const fingerprint = hash(`${msg}::${firstFrame}`);

    const now = Date.now();
    const last = lastSentAt.get(fingerprint) ?? 0;
    if (now - last < RESEND_AFTER_MS) return;
    if (sentCount >= MAX_PER_SESSION) return;
    lastSentAt.set(fingerprint, now);
    sentCount++;

    const route =
      typeof location !== 'undefined' ? location.pathname + location.hash : null;

    // rpc, not insert: the count increment has to be atomic or two errors in
    // the same tick race each other — which is exactly what a render loop does.
    void supabase
      .rpc('record_client_error', {
        p_fingerprint: fingerprint,
        p_message: msg,
        p_stack: stack,
        p_kind: opts.kind ?? 'error',
        p_route: opts.route ?? route,
        p_platform: platform(),
        p_app_version: version,
      })
      .then(({ error }) => {
        // Deliberately console-only. Reporting a failure-to-report through the
        // same channel would recurse.
        if (error) console.warn('[errorLog] could not record:', error.message);
      });
  } catch (e) {
    console.warn('[errorLog] recorder itself failed', e);
  }
}

/** Recent errors for this user, newest first — powers the diagnostics list. */
export async function recentErrors(limit = 20) {
  const { data, error } = await supabase
    .from('client_errors')
    .select('message,kind,route,count,first_seen,last_seen,platform,stack')
    .order('last_seen', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function clearErrors() {
  const { error } = await supabase.from('client_errors').delete().neq('fingerprint', '');
  if (error) throw error;
}
