// Where new people give up, counted in our own database, no trackers:
// one row per person, event and day, through note_event (migrations
// 20261029100000_app_events, 20261030120000_reminders, 20261030180000_plus_interest,
// 20261031130000_fit_ask),
// which ignores any
// name not on its list.
// owner_metrics turns them into the Numbers page. Never throws, never waits:
// counting must not slow the screen it counts.
import { supabase } from '$lib/db/client';

/** Keep equal to the list in note_event (selfcheck holds them together). */
export const APP_EVENTS = ['open', 'setup_1', 'setup_2', 'setup_3', 'setup_done', 'reminder_push', 'reminder_failed', 'reminder_calendar', 'plus_yes', 'plus_no', 'fit_yes', 'fit_unsure', 'fit_no', 'why_logging', 'why_scale', 'why_plan', 'why_confusing', 'why_broken', 'why_other'] as const;
export type AppEvent = (typeof APP_EVENTS)[number];

const sent = new Set<string>();

/** The tag of the link this person arrived by (static/from.js keeps it), sent
 *  once per device; the server keeps the first one and checks its shape. */
export function noteOrigin(): void {
  try {
    const tag = localStorage.getItem('recompos.cameFrom');
    if (!tag || localStorage.getItem('recompos.cameFromSent') === tag) return;
    void supabase.rpc('note_origin', { p_from: tag }).then(({ error }) => {
      if (error) console.warn('[events] origin not counted:', error.message);
      else try { localStorage.setItem('recompos.cameFromSent', tag); } catch { /* sent again next time */ }
    });
  } catch { /* storage off */ }
}

export function noteEvent(event: AppEvent): void {
  const key = `${event}:${new Date().toISOString().slice(0, 10)}`;
  if (sent.has(key)) return;
  sent.add(key);
  void supabase.rpc('note_event', { p_event: event }).then(({ error }) => {
    if (error) console.warn('[events] not counted:', error.message);
  });
}

// The tap map (2026-11-13, Pact m32): which named buttons get pressed on which
// screen, per day, with nothing that says who (migration 20261113140000_app_taps).
// Only elements named in code with data-tap count, never what a button shows:
// its words can be someone's food. Batched: one call every 30 s at most, and
// when the app goes to the background.
const taps = new Map<string, number>();

export function noteTap(screen: string, name: string): void {
  const k = `${screen}|${name}`;
  taps.set(k, (taps.get(k) ?? 0) + 1);
}

function flushTaps(): void {
  if (!taps.size) return;
  const list = [...taps].map(([k, n]) => ({ screen: k.slice(0, k.indexOf('|')), name: k.slice(k.indexOf('|') + 1), n }));
  taps.clear();
  void supabase.rpc('note_taps', { p_taps: list }).then(({ error }) => {
    if (error) console.warn('[events] taps not counted:', error.message);
  });
}

/** One listener for the whole app; returns the way to stop it. */
export function countTaps(): () => void {
  const onClick = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.('[data-tap]') as HTMLElement | null;
    if (el?.dataset.tap) noteTap(location.pathname, el.dataset.tap);
  };
  const onHide = () => { if (document.visibilityState === 'hidden') flushTaps(); };
  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', onHide);
  const every = setInterval(flushTaps, 30_000);
  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('visibilitychange', onHide);
    clearInterval(every);
    flushTaps();
  };
}
