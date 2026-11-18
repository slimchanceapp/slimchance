// In-app problem log.
//
// WHY: nearly every failure path in this app was `console.warn`. On a phone
// there is no console. That is the single reason "my watch workouts aren't
// syncing" went undiagnosed for so long — the app KNEW (it caught the error,
// logged it, and carried on) and had no way to tell anyone. Silent degradation
// reads to a user as "the app is lying to me", which is worse than an error.
//
// This is deliberately a ring buffer in memory, not a table: the point is to
// answer "what just went wrong?" while it is still relevant, not to build an
// analytics pipeline. Nothing leaves the device.

import { writable, derived } from 'svelte/store';

export type NoticeLevel = 'error' | 'warn' | 'info';

export interface Notice {
  id: number;
  at: number;
  level: NoticeLevel;
  /** Which subsystem — "Health Connect", "Sync", "Food AI". */
  source: string;
  message: string;
  /** Plain-language "here's what to do about it", when there is one. */
  hint?: string;
}

const MAX = 40;
let nextId = 1;

export const notices = writable<Notice[]>([]);

/** Unacknowledged error/warning count, for the top-bar badge. */
export const unreadCount = writable(0);

export function notify(
  source: string,
  message: string,
  opts: { level?: NoticeLevel; hint?: string } = {}
) {
  const level = opts.level ?? 'error';
  const entry: Notice = {
    id: nextId++,
    at: Date.now(),
    level,
    source,
    message: String(message ?? '').slice(0, 300),
    hint: opts.hint
  };
  // Keep the console line too — it's still the better tool when a laptop is
  // actually attached.
  const log = level === 'error' ? console.error : console.warn;
  log(`[${source}] ${entry.message}`);

  notices.update((list) => [entry, ...list].slice(0, MAX));
  if (level !== 'info') unreadCount.update((n) => n + 1);

  // Persist real failures so they survive a reload. Imported lazily to keep
  // this module free of the Supabase client — notices.ts is imported by
  // low-level code that must not drag the database in, and a static import
  // would also make a circular dependency (errorLog -> db/client -> ...).
  if (level === 'error') {
    import('$lib/errorLog')
      .then((m) => m.recordError(`[${source}] ${entry.message}`, { kind: 'notice' }))
      .catch(() => { /* reporting must never itself break anything */ });
  }
}

export function clearNotices() {
  notices.set([]);
  unreadCount.set(0);
}

export function markNoticesRead() {
  unreadCount.set(0);
}

/** True when something is currently wrong enough to warrant the badge. */
export const hasProblems = derived(notices, ($n) => $n.some((x) => x.level === 'error'));

/** The "Save your account" sheet, opened from Settings or Today's reminder. */
export const saveAccountOpen = writable(false);

/** "Bring your weigh-ins", opened from Settings or day one on Today. */
export const importOpen = writable(false);
