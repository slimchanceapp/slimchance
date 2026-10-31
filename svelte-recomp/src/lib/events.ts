// Where new people give up, counted in our own database, no trackers:
// one row per person, event and day, through note_event (migrations
// 20261029100000_app_events, 20261030120000_reminders, 20261030180000_plus_interest),
// which ignores any
// name not on its list.
// owner_metrics turns them into the Numbers page. Never throws, never waits:
// counting must not slow the screen it counts.
import { supabase } from '$lib/db/client';

/** Keep equal to the list in note_event (selfcheck holds them together). */
export const APP_EVENTS = ['open', 'setup_1', 'setup_2', 'setup_3', 'setup_done', 'reminder_push', 'reminder_failed', 'reminder_calendar', 'plus_yes', 'plus_no'] as const;
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
