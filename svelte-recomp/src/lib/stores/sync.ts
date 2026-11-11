import { writable, get } from 'svelte/store';
import { supabase } from '$lib/db/client';
import db from '$lib/db/dexie';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { notify } from './notices';
import { pageAll } from '$lib/paging';
import { userId } from './user';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
export const syncStatus = writable<SyncStatus>('idle');
export const syncError = writable<string | null>(null);

const channels: RealtimeChannel[] = [];

// Tables whose local key is an id the SERVER assigns (bigint identity), not a
// natural key. A row put on this device before the server has given it an id
// gets a second, local one: the same weigh-in stored twice, which the trend
// then counts twice. So rows of these tables are written locally only as the
// server returned them, and a full pull removes any local row the server
// doesn't have.
const SERVER_IDS = new Set(['weights', 'steps', 'sessions']);

/** After a full pull of one of those tables: drop this device's rows the
 *  server doesn't have (strays from before this fix, or rows deleted on
 *  another device while this one was offline). Local writes only ever follow
 *  a server write, so nothing unsaved can be lost here. */
async function dropStrays(table: string, data: any[]) {
  if (!SERVER_IDS.has(table)) return;
  const uid = get(userId);
  if (!uid) return;
  const ids = new Set(data.map((r) => r.id));
  await dexieTable(table).where('user_id').equals(uid).filter((r: any) => !ids.has(r.id)).delete();
}

const TABLES = ['alarms', 'daily_logs', 'checks', 'tracks', 'weights', 'steps', 'sessions', 'user_settings', 'workout_schedule', 'workout_sessions_custom', 'workout_logs', 'food_logs', 'biometrics', 'recipes_custom', 'activity_sessions'] as const;

function dexieTable(table: string) {
  return db.table(table);
}

/**
 * Every row of one table the user can see, paged (see pageAll: a bare
 * select('*') stopped at 1000 rows without a word, so past 1000 food entries
 * the newest would never have come down). Ordered by the table's conflict
 * key, which is unique, so pages never overlap or skip.
 */
const pullTable = (table: (typeof TABLES)[number]) => pageAll(async (from, to) => {
  let q = supabase.from(table).select('*');
  for (const col of CONFLICT[table].split(',')) q = q.order(col);
  const { data, error } = await q.range(from, to);
  if (error) throw error;
  return (data ?? []) as any[];
});

/**
 * What each table held the last time it was pulled. A refresh that brings back
 * the same rows writes nothing: a write wakes every screen that reads the
 * table, and most refreshes change nothing at all. Cleared on sign-out, and
 * initSync always writes, so a fresh local database is always filled.
 */
const lastPulled = new Map<string, string>();

function primaryKeyFor(table: string, record: Record<string, any>): any {
  switch (table) {
    case 'daily_logs': return [record.user_id, record.date];
    case 'checks':
    case 'tracks': return [record.id, record.user_id];
    case 'user_settings': return record.user_id;
    case 'workout_schedule': return [record.user_id, record.day_of_week];
    case 'workout_sessions_custom': return [record.user_id, record.key];
    case 'workout_logs': return [record.user_id, record.date, record.exercise_name];
    case 'biometrics': return [record.user_id, record.date];
    default: return record.id;
  }
}

async function handleChange(payload: RealtimePostgresChangesPayload<Record<string, any>>) {
  const table = payload.table;
  const eventType = payload.eventType;
  console.log(`[Sync] realtime ${eventType} on ${table}:`, payload);

  try {
    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const record = payload.new;
      await dexieTable(table).put(record);
    } else if (eventType === 'DELETE') {
      const record = payload.old;
      const key = primaryKeyFor(table, record);
      console.log(`[Sync] deleting ${table} key:`, key, 'from old row:', record);
      await dexieTable(table).delete(key);
    }
  } catch (e) {
    console.warn(`Sync: error handling ${eventType} on ${table}:`, e);
  }
}

export async function initSync(uid: string) {
  syncStatus.set('syncing');

  try {
    // Fetch + subscribe to every table in parallel instead of sequentially
    // awaiting one at a time. The old sequential loop meant syncStatus
    // could flip to 'synced' as soon as the FIRST (fastest) table's
    // channel subscribed, well before a table further down the list (e.g.
    // meal_plans, 8th of 13) had actually finished its initial fetch --
    // any page relying on "$syncStatus === 'synced' -> reload" to refresh
    // its data could silently miss the update for that slower table
    // entirely. Doing this in parallel shrinks that race window from
    // "up to 12 sequential round-trips" to "one round-trip", and pages
    // should prefer live.ts's liveQuery-based helpers (which react to the
    // IndexedDB write itself, not to syncStatus) wherever possible anyway.
    // Per-table isolation: ONE table failing must not take the other thirteen
    // down with it. A table can legitimately be missing server-side — a client
    // deploy that adds a table always lands before its migration does — and the
    // old Promise.all rejected the whole batch on the first error, leaving the
    // app stuck in a permanent 'error' state with no weights, food or workouts
    // syncing because of one absent table.
    const failures: string[] = [];
    await Promise.all(TABLES.map(async (table) => {
      try {
        const data = await pullTable(table);
        if (data.length > 0) await dexieTable(table).bulkPut(data);
        await dropStrays(table, data);
        lastPulled.set(table, JSON.stringify(data));

        const channel = supabase
          .channel(`${table}-sync-${uid}`)
          .on('postgres_changes',
            { event: '*', schema: 'public', table },
            (payload) => handleChange(payload as any)
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') syncStatus.set('synced');
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              syncStatus.set('error');
            }
          });

        channels.push(channel);
      } catch (e: any) {
        failures.push(table);
        notify('Sync', `"${table}" did not load: ${e?.message || e}`, {
          level: 'warn',
          hint: 'Usually means the table is missing server-side — the rest of the app still works.'
        });
      }
    }));

    if (failures.length === TABLES.length) {
      throw new Error('Could not reach the server.');
    }
    syncStatus.set('synced');
    // Name the tables that failed rather than a vague "sync error" — this is
    // exactly the diagnostic that was missing when watch workouts silently
    // stopped arriving.
    syncError.set(failures.length ? `Not synced: ${failures.join(', ')}` : null);
  } catch (e: any) {
    syncStatus.set('error');
    syncError.set(e?.message || 'Sync failed');
    console.error('Sync init failed:', e);
  }
}

/**
 * Re-pull every table from Supabase into Dexie, without touching the realtime
 * channels (initSync already owns those — re-running it would stack duplicate
 * subscriptions for every table, every refresh).
 *
 * Realtime normally keeps the local mirror current on its own, but it can't
 * when the socket dropped while the phone was asleep or offline, and a native
 * app that lives in the background for days hits that constantly. Pull-to-
 * refresh needs a way to say "just go and get the truth", so here it is.
 */
export async function refetchAll(): Promise<void> {
  syncStatus.set('syncing');
  const failures: string[] = [];
  await Promise.all(
    TABLES.map(async (table) => {
      try {
        const data = await pullTable(table);
        const seen = JSON.stringify(data);
        if (lastPulled.get(table) === seen) return;
        if (data.length > 0) await dexieTable(table).bulkPut(data);
        await dropStrays(table, data);
        lastPulled.set(table, seen);
      } catch (e: any) {
        failures.push(table);
        notify('Sync', `Refresh of "${table}" failed: ${e?.message || e}`, { level: 'warn' });
      }
    })
  );

  if (failures.length === TABLES.length) {
    syncStatus.set('error');
    syncError.set('Could not reach the server.');
    throw new Error('Could not reach the server.');
  }
  syncStatus.set('synced');
  syncError.set(failures.length ? `Not synced: ${failures.join(', ')}` : null);
}

/**
 * The column(s) Postgres resolves an upsert on, per synced table — one table
 * of facts instead of a fourteen-branch if/else. selfcheck fails if a table
 * joins TABLES without an entry here.
 */
export const CONFLICT: Record<(typeof TABLES)[number], string> = {
  alarms: 'id',
  daily_logs: 'user_id,date',
  checks: 'id',
  tracks: 'id',
  weights: 'user_id,date',
  steps: 'user_id,date',
  sessions: 'id',
  user_settings: 'user_id',
  workout_schedule: 'user_id,day_of_week',
  workout_sessions_custom: 'user_id,key',
  workout_logs: 'user_id,date,exercise_name',
  food_logs: 'id',
  biometrics: 'user_id,date',
  recipes_custom: 'id',
  activity_sessions: 'id',
};

export async function upsertRecord(table: string, data: Record<string, any>) {
  return upsertRecords(table, [data]);
}

/**
 * Write several rows of one table as ONE request — one INSERT … ON CONFLICT
 * statement, so Postgres saves all of them or none. A meal of three items, or
 * a seeded plan, can no longer land half-written: a failure throws with
 * nothing saved, and retrying can't duplicate the rows that did get through.
 * Every row must carry the same columns (a missing column would be written as
 * NULL over the stored value).
 */
export async function upsertRecords(table: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const cols = (r: Record<string, any>) => Object.keys(r).filter((k) => r[k] !== undefined).sort().join(',');
  if (rows.some((r) => cols(r) !== cols(rows[0]))) {
    throw new Error(`upsertRecords(${table}): every row needs the same columns`);
  }
  const currentStatus = get(syncStatus);
  if (currentStatus !== 'synced' && currentStatus !== 'syncing') {
    syncStatus.set('syncing');
  }

  try {
    const onConflict = (CONFLICT as Record<string, string>)[table];

    // When the row is identified by a NATURAL key (user_id,date / user_id,key /
    // …) rather than its surrogate `id`, never send that surrogate `id` to
    // Postgres. `weights`, `steps` and `sessions` declare `id` as
    //   bigint GENERATED ALWAYS AS IDENTITY
    // and Postgres rejects ANY explicit value for such a column ("cannot insert
    // a non-DEFAULT value into column id") — and it rejects it while planning the
    // INSERT, BEFORE `ON CONFLICT` can turn it into an update. So the very first
    // weigh-in of a day (no existing row → no id sent) saved fine, but EVERY
    // later edit of that same day sent the existing id and failed. Dropping the
    // id here lets the natural-key conflict resolve to a clean UPDATE. The local
    // Dexie put below still keeps the id so the correct local row is updated in
    // place (no duplicate optimistic row).
    const remote = onConflict && onConflict !== 'id'
      ? rows.map(({ id, ...rest }) => rest)
      : rows;

    const write = supabase.from(table).upsert(remote, onConflict ? { onConflict } : {});
    const { data: saved, error } = SERVER_IDS.has(table) ? await write.select() : await write;

    if (error) {
      syncStatus.set('error');
      throw error;
    }

    if (SERVER_IDS.has(table)) {
      // This device keeps the server's rows, with the server's ids: those
      // days' local rows are replaced, never added to.
      const rowsBack = (saved ?? []) as any[];
      if (table !== 'sessions' && rowsBack.length) {
        await dexieTable(table).where('[user_id+date]').anyOf(rowsBack.map((r) => [r.user_id, r.date])).delete();
      }
      if (rowsBack.length) await dexieTable(table).bulkPut(rowsBack);
      syncStatus.set('synced');
      return;
    }

    // Defensive: Svelte 5 $state proxies (arrays/objects) can fail
    // IndexedDB's structured-clone algorithm ("could not be cloned") if a
    // caller accidentally passes a reactive value straight through. A
    // JSON round-trip guarantees a plain, clonable value at negligible cost
    // for these small records.
    //
    // MERGE into the local row, the way Postgres just did. Callers send only
    // the columns they change — water glasses, a back-pain rating, a program
    // — and a bare put() replaced the whole local row with that fragment:
    // the goal, the profile or the day's other fields vanished on this device
    // until a realtime echo happened to restore them.
    for (const row of rows) {
      const plain = JSON.parse(JSON.stringify(row));
      const key = primaryKeyFor(table, plain);
      const hasKey = Array.isArray(key) ? key.every((k) => k != null) : key != null;
      const existing = hasKey ? await dexieTable(table).get(key).catch(() => undefined) : undefined;
      await dexieTable(table).put(existing ? { ...existing, ...plain } : plain);
    }
    syncStatus.set('synced');
  } catch (e: any) {
    syncStatus.set('error');
    syncError.set(e?.message || 'Upsert failed');
    throw e;
  }
}

export function destroySync() {
  channels.forEach((ch) => ch.unsubscribe());
  channels.length = 0;
  lastPulled.clear();
  syncStatus.set('idle');
}
