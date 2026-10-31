/**
 * Health Connect integration (native Android only).
 *
 * When RecompOS runs inside its Capacitor Android shell, this reads the
 * OnePlus Watch data that OHealth mirrors into Health Connect (steps, sleep,
 * resting heart rate, HRV) and writes it into the app's own `steps` and
 * `biometrics` tables. That makes the Daily Readiness card and step stats
 * light up with real watch data using the exact same data path as manual entry.
 *
 * In a browser (phone or desktop) everything here no-ops, so the web
 * build is completely unaffected.
 */
import { writable } from 'svelte/store';
import db from '$lib/db/dexie';
import { supabase } from '$lib/db/client';
import { upsertRecords } from '$lib/stores/sync';
import { buildActivitySessions } from './exercise';
import { sleepNights } from './sleep';
import { hasPlugin, isAndroidApp, isIOSApp } from '$lib/platform';
import { type RecordType, READ_TYPES, READ_PERMISSION, WRITE_TYPES, canWrite, readTypesKey } from './permissions';
import { pickOriginByDay, countOrigins, percentile, changedDays, sameSessions } from './dedupe';
import { preferredSource } from './watches';
import { scaleDays } from './scaleWeights';
import { notify } from '$lib/stores/notices';

// Health Connect sleep-stage codes counted as actually asleep
// (2 SLEEPING, 4 LIGHT, 5 DEEP, 6 REM). Awake / out-of-bed / awake-in-bed excluded.
const ASLEEP_STAGES = new Set([2, 4, 5, 6]);

// Set by aggregate(), read by the sync that calls it, so the per-source step
// breakdown can reach the diagnostics UI without rethreading the return type.
let lastStepsToday: { total: number; origin: string | null; candidates: Record<string, number> } | null = null;

// Keyed on the SET of types we request, so adding a record type earns exactly
// one fresh prompt instead of being blocked forever by an old "already asked"
// flag. See readTypesKey().
const PERM_ASKED_KEY = readTypesKey();

/** User-chosen preferred data source (package name), or null for auto-detect. */
const SOURCE_PREF_KEY = 'hc-preferred-source';
/** The wearable brand the user told us they own (see health/watches.ts). */
const WATCH_BRAND_KEY = 'hc-watch-brand';

function readPref(): string | null {
  try {
    return localStorage.getItem(SOURCE_PREF_KEY);
  } catch {
    return null;
  }
}

function readBrand(): string | null {
  try {
    return localStorage.getItem(WATCH_BRAND_KEY);
  } catch {
    return null;
  }
}

/**
 * Record which wearable the user owns. Mirrored from their profile on every
 * device, so the right source is trusted even before they touch any settings.
 */
export function setWatchBrand(brandId: string | null) {
  try {
    if (brandId) localStorage.setItem(WATCH_BRAND_KEY, brandId);
    else localStorage.removeItem(WATCH_BRAND_KEY);
  } catch {
    /* ignore */
  }
}

/** Persist the source the user wants trusted when several write the same signal. */
export function setPreferredSource(pkg: string | null) {
  try {
    if (pkg) localStorage.setItem(SOURCE_PREF_KEY, pkg);
    else localStorage.removeItem(SOURCE_PREF_KEY);
  } catch {
    /* ignore */
  }
}

export type HealthConnectState = {
  available: boolean;
  native: boolean;
  syncing: boolean;
  lastSync: string | null;
  lastError: string | null;
  lastResult: { days: number; steps: number; sleep: number; hr: number; workouts: number } | null;
  /** Read-permission strings actually granted at the last sync (null = unknown). */
  grantedPerms: string[] | null;
  /** Every app that wrote data we read (package names) — usually >1, which is
   *  exactly why de-duplication is needed. Lets the UI explain the numbers. */
  sources: string[];
  /** The source actually trusted for daily totals (auto-detected or user-set). */
  activeSource: string | null;
  /** True when the user pinned `activeSource` by hand rather than auto-detect. */
  sourcePinned: boolean;
  /**
   * Today's step count broken down by every app that wrote steps, plus which
   * one the de-duplication kept. Without this, "my watch says 5268 but the app
   * says 2069" is unanswerable from outside the device — you cannot tell a
   * partial source from a source that simply has not synced yet.
   */
  stepsToday: { total: number; origin: string | null; candidates: Record<string, number> } | null;
  /** Wearable brand id the user declared, for brand-specific setup help. */
  watchBrand: string | null;
};

export const healthConnect = writable<HealthConnectState>({
  available: false,
  native: false,
  syncing: false,
  lastSync: null,
  lastError: null,
  lastResult: null,
  grantedPerms: null,
  sources: [],
  activeSource: null,
  sourcePinned: false,
  stepsToday: null,
  watchBrand: null
});

function ymd(d: string | number | Date): string {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function startOfDaysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/** Lazily resolve the native plugin (dynamic import keeps it out of SSR/prerender). */
async function getNative(): Promise<{ Capacitor: any; HealthConnect: any } | null> {
  try {
    if (!isAndroidApp()) return null;
    const { Capacitor } = await import('@capacitor/core');
    const { HealthConnect } = await import('@kiwi-health/capacitor-health-connect');
    return { Capacitor, HealthConnect };
  } catch {
    return null;
  }
}

async function readAll(
  HealthConnect: any,
  type: RecordType,
  startISO: string,
  endISO: string
): Promise<any[]> {
  try {
    const { records } = await HealthConnect.readRecords({
      type,
      // The plugin types this as Date but the Capacitor JSON bridge needs
      // ISO strings (Kotlin does Instant.parse).
      timeRangeFilter: { type: 'between', startTime: startISO, endTime: endISO }
    });
    return records || [];
  } catch (e: any) {
    // Never fatal — one unreadable type must not stop the rest of the sync.
    // But it MUST be visible: an empty result here is exactly how "my workouts
    // never appear" looked for weeks.
    notify('Health Connect', `Could not read ${type}: ${e?.message || e}`, {
      level: 'warn',
      hint: `Open Health Connect and confirm Slim Chance is allowed to read ${type}.`
    });
    return [];
  }
}

type DayAgg = {
  steps: number | null;
  sleep_hours: number | null;
  resting_hr: number | null;
  hrv: number | null;
};

/** Minutes actually asleep in a SleepSession, from its stages when present. */
function sleepMinutes(s: any): number {
  if (Array.isArray(s.stages) && s.stages.length) {
    let mins = 0;
    for (const st of s.stages) {
      if (ASLEEP_STAGES.has(Number(st.stage))) {
        mins += (new Date(st.endTime).getTime() - new Date(st.startTime).getTime()) / 60000;
      }
    }
    if (mins > 0) return mins;
  }
  return (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
}

const originOf = (r: any) => String(r?.metadata?.dataOrigin || 'unknown');

/**
 * Collapse raw Health Connect records into one row per day.
 *
 * The critical correctness rule here is that we pick ONE source per signal per
 * day rather than summing across sources — see dedupe.ts. Summing was why the
 * app's numbers never matched the watch: the phone's step counter and the
 * watch's mirrored steps were being added together.
 */
function aggregate(
  steps: any[],
  sleeps: any[],
  hrSeries: any[],
  restingHr: any[],
  hrv: any[],
  preferred: string | null
): Record<string, DayAgg> {
  // — Steps: one source per day, summed within that source only. —
  const stepPick = pickOriginByDay(steps, {
    dayOf: (r) => ymd(r.startTime),
    valueOf: (r) => Number(r.count) || 0,
    originOf,
    preferred
  });
  const stepsByDay: Record<string, number> = {};
  for (const [day, pick] of Object.entries(stepPick)) stepsByDay[day] = pick.total;
  const todayKey = ymd(new Date());
  const todayPick = stepPick[todayKey];
  lastStepsToday = todayPick
    ? { total: todayPick.total, origin: todayPick.origin, candidates: todayPick.candidates }
    : { total: 0, origin: null, candidates: {} };

  // — Sleep: sessions a watch split (awake at 3 a.m., asleep again by 4) are
  // joined into one night first (health/sleep.ts), attributed to the WAKE day
  // so it reads as "today's" readiness after you get up. Pick one source, then
  // take that source's LONGEST night for the day: summing every night would
  // fold afternoon naps into "last night's sleep", and summing across sources
  // counted the same night twice when both the watch and the phone recorded it. —
  const nights = sleepNights(sleeps, { originOf, minutesOf: sleepMinutes, dayOf: ymd });
  const sleepPick = pickOriginByDay(nights, {
    dayOf: (n) => n.day,
    valueOf: (n) => n.minutes,
    originOf: (n) => n.origin,
    preferred
  });
  const sleepMinByDay: Record<string, number> = {};
  for (const [day, pick] of Object.entries(sleepPick)) {
    const longest = pick.records.reduce((best, n) => Math.max(best, n.minutes), 0);
    if (longest > 0) sleepMinByDay[day] = longest;
  }

  // — Resting HR / HRV: averaged per day within the winning source. —
  const rhrPick = pickOriginByDay(restingHr, {
    dayOf: (r) => ymd(r.time),
    valueOf: (r) => Number(r.beatsPerMinute) || 0,
    originOf,
    preferred
  });
  const hrvPick = pickOriginByDay(hrv, {
    dayOf: (r) => ymd(r.time),
    valueOf: (r) => Number(r.heartRateVariabilityMillis) || 0,
    originOf,
    preferred
  });

  // — Fallback resting HR from the raw heart-rate series. The old code used the
  // single LOWEST sample of the day, which is one deep-sleep outlier and reads
  // several bpm under what the watch calls resting HR. The 5th percentile
  // tracks a wearable's own RHR far more closely. —
  const hrSamplesByDay: Record<string, number[]> = {};
  for (const series of hrSeries) {
    for (const sample of series.samples || []) {
      const day = ymd(sample.time);
      const bpm = Number(sample.beatsPerMinute);
      if (!bpm) continue;
      (hrSamplesByDay[day] = hrSamplesByDay[day] || []).push(bpm);
    }
  }

  const avg = (arr?: number[]) =>
    arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const days = new Set<string>([
    ...Object.keys(stepsByDay),
    ...Object.keys(sleepMinByDay),
    ...Object.keys(rhrPick),
    ...Object.keys(hrvPick),
    ...Object.keys(hrSamplesByDay)
  ]);

  const byDay: Record<string, DayAgg> = {};
  for (const day of days) {
    // A real RestingHeartRate record always beats a percentile guess.
    const rhrRecords = rhrPick[day]?.records ?? [];
    const rhrDirect = rhrRecords.length
      ? avg(rhrRecords.map((r: any) => Number(r.beatsPerMinute)).filter((n: number) => n > 0))
      : null;
    const rhrDerived = hrSamplesByDay[day] ? percentile(hrSamplesByDay[day], 0.05) : null;
    const restingHrVal =
      rhrDirect != null ? Math.round(rhrDirect) : rhrDerived != null ? Math.round(rhrDerived) : null;

    const hrvRecords = hrvPick[day]?.records ?? [];
    const hrvVal = hrvRecords.length
      ? avg(
          hrvRecords
            .map((r: any) => Number(r.heartRateVariabilityMillis))
            .filter((n: number) => n > 0)
        )
      : null;

    byDay[day] = {
      steps: stepsByDay[day] != null ? Math.round(stepsByDay[day]) : null,
      sleep_hours:
        sleepMinByDay[day] != null ? Math.round((sleepMinByDay[day] / 60) * 10) / 10 : null,
      resting_hr: restingHrVal,
      hrv: hrvVal != null ? Math.round(hrvVal * 10) / 10 : null
    };
  }
  return byDay;
}

/** Steps: every changed day in one upsert, then one local row per day. */
async function pushSteps(uid: string, rows: Array<{ user_id: string; date: string; count: number }>) {
  const { data, error } = await supabase.from('steps').upsert(rows, { onConflict: 'user_id,date' }).select();
  if (error) throw error;
  if (!data?.length) return;
  // The Dexie `steps` table has an auto-increment key, so a keyless put would
  // create duplicates. Replace those days' local rows with the authoritative
  // Supabase rows (which carry a stable id): two writes, not two per day.
  try {
    await db.table('steps').where('[user_id+date]').anyOf(data.map((r: any) => [uid, r.date])).delete();
  } catch {
    /* index may be missing on very old dbs; ignore */
  }
  await db.table('steps').bulkPut(data);
}

/**
 * Save what a read changed (see changedDays): at most one request for steps
 * and one for sleep/heart rate, in parallel, and none at all when every day
 * came back as saved, which is most refreshes.
 */
async function saveDays(uid: string, byDay: Record<string, DayAgg>): Promise<{ steps: boolean; bio: boolean }> {
  const [savedSteps, savedBio] = await Promise.all([
    db.table('steps').where('user_id').equals(uid).toArray().catch(() => [] as any[]),
    db.table('biometrics').where('user_id').equals(uid).toArray().catch(() => [] as any[]),
  ]);
  const { steps, bio } = changedDays(uid, byDay,
    new Map(savedSteps.map((r: any) => [r.date, r.count])),
    new Map(savedBio.map((r: any) => [r.date, r])));
  const at = new Date().toISOString();
  const [s, b] = await Promise.allSettled([
    steps.length ? pushSteps(uid, steps) : null,
    bio.length ? upsertRecords('biometrics', bio.map((r) => ({ ...r, updated_at: at }))) : null,
  ]);
  if (s.status === 'rejected') notify('Health Connect', `Could not save steps: ${s.reason?.message || s.reason}`, { level: 'warn' });
  if (b.status === 'rejected') notify('Health Connect', `Could not save sleep/HR: ${b.reason?.message || b.reason}`, { level: 'warn' });
  return { steps: s.status === 'fulfilled', bio: b.status === 'fulfilled' };
}

/**
 * Watch workouts: replace this user's activity sessions in the read window with
 * the freshly read set, locally AND in Postgres. We clear the window and re-put
 * so deleted/edited watch sessions don't linger.
 *
 * These used to be Dexie-only. That made a watch session the one datum that
 * could not survive a reinstall, reach a second device, or be verified by
 * anything off-phone \u2014 for the single strongest piece of evidence the app has
 * that training happened. Now it round-trips like every other owned row.
 */
async function pushActivitySessions(
  uid: string,
  sessions: { id: string; date: string }[],
  sinceYmd: string
): Promise<number> {
  try {
    const saved = await db
      .table('activity_sessions')
      .where('[user_id+date]')
      .between([uid, sinceYmd], [uid, '\uffff'])
      // Same rule as the remote delete below: a hand-logged session is never in
      // the watch's fresh set, so clearing the window unfiltered would erase it.
      .filter((r: any) => (r?.source ?? 'watch') === 'watch')
      .toArray();
    // The same sessions as last time (most refreshes): nothing to rewrite,
    // here or on the server.
    if (sameSessions(saved, sessions)) return sessions.length;
    if (saved.length) await db.table('activity_sessions').bulkDelete(saved.map((r: any) => r.id));
  } catch {
    /* index may be missing on very old dbs; ignore */
  }
  if (sessions.length) {
    try {
      await db.table('activity_sessions').bulkPut(sessions);
    } catch (e) {
      console.warn('[HealthConnect] activity put failed', e);
    }
  }

  // Remote half. Never let a network failure lose the local copy \u2014 the phone
  // is the source of truth here and a later sync will reconcile.
  try {
    let del = supabase
      .from('activity_sessions')
      .delete()
      .eq('user_id', uid)
      .gte('date', sinceYmd)
      // ONLY watch rows. This clears the window so sessions deleted on the
      // watch stop lingering — but a hand-logged session is not in the watch's
      // fresh set by definition, so without this filter every sync would
      // silently delete every session the user entered themselves.
      .eq('source', 'watch');
    if (sessions.length) {
      // Quote each id: Health Connect UIDs are opaque and may contain commas
      // or parens, which would otherwise break the PostgREST `in` list.
      const ids = sessions.map((s) => `"${String(s.id).replace(/"/g, '""')}"`).join(',');
      del = del.not('id', 'in', `(${ids})`);
    }
    const { error: delErr } = await del;
    if (delErr) throw delErr;

    if (sessions.length) {
      const { error } = await supabase
        .from('activity_sessions')
        .upsert(JSON.parse(JSON.stringify(sessions)), { onConflict: 'id' });
      if (error) throw error;
    }
  } catch (e: any) {
    console.warn('[HealthConnect] activity remote sync failed', e);
  }

  return sessions.length;
}

type PermCheck = { ok: boolean; granted: Set<string> };

async function ensurePermissions(HealthConnect: any): Promise<PermCheck> {
  const { availability } = await HealthConnect.checkAvailability();
  healthConnect.update((s) => ({ ...s, available: availability === 'Available' }));
  if (availability === 'NotSupported') return { ok: false, granted: new Set() };

  const check = await HealthConnect.checkHealthPermissions({ read: READ_TYPES, write: WRITE_TYPES });
  if (check.hasAllPermissions) {
    return { ok: true, granted: new Set(check.grantedPermissions || []) };
  }

  // Only auto-prompt once PER TYPE SET so we don't nag after a decline — but do
  // ask again when we start requesting a type the user was never shown.
  const asked = typeof localStorage !== 'undefined' && localStorage.getItem(PERM_ASKED_KEY);
  if (asked) {
    const granted = new Set<string>(check.grantedPermissions || []);
    return { ok: granted.size > 0, granted };
  }
  try {
    localStorage.setItem(PERM_ASKED_KEY, '1');
  } catch {
    /* ignore */
  }

  try {
    await HealthConnect.requestHealthPermissions({ read: READ_TYPES, write: WRITE_TYPES });
  } catch (e) {
    // A cancelled or suppressed dialog is not fatal — we still hold whatever was
    // granted before, and the re-check below finds it.
    console.warn('[HealthConnect] permission request did not complete', e);
  }

  // CRITICAL: never trust the dialog's own return value. It comes from
  // PermissionController.parseResult(), which reports what THAT dialog granted —
  // and Health Connect returns an empty set whenever it declines to re-show the
  // prompt (Android stops re-prompting once the user has answered). The old code
  // treated that empty set as "nothing is granted", threw
  // "Health Connect permission not granted", and threw away permissions the app
  // genuinely held — so pressing Sync could take working data away. Re-checking
  // is the only authoritative answer.
  const after = await HealthConnect.checkHealthPermissions({ read: READ_TYPES, write: WRITE_TYPES });
  const granted = new Set<string>(after.grantedPermissions || []);
  return { ok: after.hasAllPermissions || granted.size > 0, granted };
}

/**
 * Open the Health Connect settings screen for this app.
 *
 * This is the ONLY reliable recovery once Android has stopped showing the
 * permission dialog (it refuses to re-prompt after the user has answered, so an
 * in-app "try again" button can be a no-op forever). The UI offers this whenever
 * a signal reads "not allowed".
 */
export async function openHealthConnectSettings(): Promise<boolean> {
  const native = await getNative();
  if (!native) return false;
  try {
    await native.HealthConnect.openHealthConnectSetting();
    // The user may toggle permissions while we're backgrounded — forget the
    // "already asked" flag so the next sync re-reads the real grant state.
    localStorage.removeItem(PERM_ASKED_KEY);
    return true;
  } catch (e) {
    console.warn('[HealthConnect] could not open settings', e);
    return false;
  }
}

let running = false;

/**
 * How far back a sync reads. Two weeks catches a watch that synced late, but
 * re-reading it on every pull meant thousands of heart-rate samples across the
 * bridge each time for days that don't change. So: the full two weeks at most
 * every six hours (and whenever the user forces a sync), the last three days
 * otherwise.
 */
const FULL_DAYS = 14;
const RECENT_DAYS = 3;
/** A phone's first sync reads a month back, as far as Health Connect lets an
 *  app read before its first permission, so the trend and "Getting fitter?"
 *  can answer on day one. */
const HISTORY_DAYS = 30;
const FULL_READ_KEY = 'hc-last-full-read';
function fullReadDue(): boolean {
  try {
    const at = Date.parse(localStorage.getItem(FULL_READ_KEY) ?? '');
    return !(Date.now() - at < 6 * 60 * 60 * 1000);
  } catch {
    return true;
  }
}

/**
 * Read Health Connect and sync into the app. No-ops off native.
 * @param force  when true, prompts for permissions even if previously asked.
 */
export async function syncHealthConnect(
  uid: string,
  opts: { days?: number; force?: boolean } = {}
): Promise<HealthConnectState> {
  const native = await getNative();
  healthConnect.update((s) => ({ ...s, native: !!native }));
  if (!native) {
    // The iPhone app reads its weigh-ins from Apple Health instead.
    if (isIOSApp()) await syncAppleHealthWeights(uid).catch((e: any) => {
      notify('Apple Health', `Could not read your weigh-ins: ${e?.message || e}`, { level: 'warn' });
    });
    return getState();
  }
  if (running) return getState();
  running = true;
  healthConnect.update((s) => ({ ...s, syncing: true, lastError: null }));

  const { HealthConnect } = native;
  try {
    if (opts.force) {
      try {
        localStorage.removeItem(PERM_ASKED_KEY);
      } catch {
        /* ignore */
      }
    }
    const { ok, granted } = await ensurePermissions(HealthConnect);
    // Record exactly what's granted so the UI can show a per-signal breakdown
    // ("steps: OK, sleep: not granted") even before any data lands.
    healthConnect.update((s) => ({ ...s, grantedPerms: Array.from(granted) }));
    if (!ok) throw new Error('Health Connect permission not granted');

    const full = opts.force || fullReadDue();
    const nDays = opts.days ?? (full ? FULL_DAYS : RECENT_DAYS);
    let first = false;
    try { first = !localStorage.getItem('hc-last-sync'); } catch { /* no storage: not a first sync */ }
    const histDays = Math.max(nDays, first ? HISTORY_DAYS : 0);
    const startISO = startOfDaysAgo(histDays).toISOString();
    // Heart-rate samples stay at nDays: they are the heavy read, and only fill
    // in a day that has no resting-rate record.
    const samplesISO = startOfDaysAgo(nDays).toISOString();
    const endISO = new Date().toISOString();

    // CRITICAL: only read record types the user actually granted. Reading an
    // ungranted type throws inside the plugin's unguarded native coroutine and
    // HARD-CRASHES the app (see READ_PERMISSION note). This gate degrades the
    // feature gracefully instead — grant steps only, you get steps only.
    const canRead = (t: RecordType) => granted.has(READ_PERMISSION[t]);
    const read = (t: RecordType, from = startISO) => (canRead(t) ? readAll(HealthConnect, t, from, endISO) : Promise.resolve([]));

    const [steps, sleeps, hrSeries, restingHr, hrv, exercises, activeCals, totalCals, distances] =
      await Promise.all([
        read('Steps'),
        read('SleepSession'),
        read('HeartRateSeries', samplesISO),
        read('RestingHeartRate'),
        read('HeartRateVariabilityRmssd'),
        read('ExerciseSession'),
        read('ActiveCaloriesBurned'),
        read('TotalCaloriesBurned'),
        read('Distance')
      ]);

    // Which apps are writing into Health Connect? Usually more than one, and
    // that is precisely why the app's numbers didn't match the watch — the old
    // code summed every source's copy of the same day. Prefer the user's pinned
    // source, else auto-detect the watch, else fall back to "most data wins"
    // inside pickOriginByDay.
    const sources = countOrigins(
      [...steps, ...sleeps, ...restingHr, ...hrv, ...exercises, ...activeCals, ...totalCals, ...distances],
      originOf
    );
    const pinned = readPref();
    // The user's declared brand beats any heuristic — they know what's on
    // their wrist. Falls back to auto-detection when they never told us.
    const preferred = pinned && sources.includes(pinned) ? pinned : preferredSource(sources, readBrand());
    healthConnect.update((s) => ({
      ...s,
      sources,
      activeSource: preferred,
      sourcePinned: !!pinned && sources.includes(pinned),
      watchBrand: readBrand()
    }));

    const byDay = aggregate(steps, sleeps, hrSeries, restingHr, hrv, preferred);
    const dates = Object.keys(byDay).sort();
    healthConnect.update((s) => ({ ...s, stepsToday: lastStepsToday }));

    // Watch workouts (badminton, runs, strength sessions) → activity_sessions.
    // Calories/distance are restricted to the trusted source for the same
    // double-counting reason: with two writers, a 400 kcal match reported ~800.
    const fromPreferred = (rows: any[]) =>
      preferred ? rows.filter((r) => originOf(r) === preferred) : rows;
    const activity = buildActivitySessions({
      uid,
      exercises,
      activeCals: fromPreferred(activeCals),
      totalCals: fromPreferred(totalCals),
      distances: fromPreferred(distances),
      hrSeries
    });
    // Workouts, steps and sleep/HR are independent: save them side by side.
    const [workoutDays, saved] = await Promise.all([
      pushActivitySessions(uid, activity, ymd(startOfDaysAgo(histDays))).catch((e: any) => {
        notify('Health Connect', `Could not save watch workouts: ${e?.message || e}`, { level: 'warn' });
        return 0;
      }),
      saveDays(uid, byDay),
    ]);
    // Smart-scale weigh-ins: their own permission, asked once, on new builds only.
    await syncScaleWeights(HealthConnect, uid).catch((e: any) => {
      notify('Health Connect', `Could not read your scale's weigh-ins: ${e?.message || e}`, { level: 'warn' });
    });
    const stepDays = saved.steps ? dates.filter((d) => byDay[d].steps != null).length : 0;
    const sleepDays = saved.bio ? dates.filter((d) => byDay[d].sleep_hours != null).length : 0;
    const hrDays = saved.bio ? dates.filter((d) => byDay[d].resting_hr != null || byDay[d].hrv != null).length : 0;

    const result = { days: dates.length, steps: stepDays, sleep: sleepDays, hr: hrDays, workouts: workoutDays };
    const now = new Date().toISOString();
    try {
      localStorage.setItem('hc-last-sync', now);
      if (nDays >= FULL_DAYS) localStorage.setItem(FULL_READ_KEY, now);
    } catch {
      /* ignore */
    }
    healthConnect.update((s) => ({
      ...s,
      syncing: false,
      lastSync: now,
      // The counts mean "days with data in the last two weeks"; a short read
      // would make them shrink, which reads as data going missing.
      lastResult: nDays >= FULL_DAYS ? result : s.lastResult ?? result,
      lastError: null
    }));
  } catch (e: any) {
    notify('Health Connect', e?.message || 'Sync failed', {
      hint: 'Tap Sync again, or open Health Connect permissions from the Readiness card.'
    });
    healthConnect.update((s) => ({
      ...s,
      syncing: false,
      lastError: e?.message || 'Health Connect sync failed'
    }));
  } finally {
    running = false;
  }
  return getState();
}

const WEIGHT_PERM = READ_PERMISSION.Weight;
/** The first native build that declares READ_WEIGHT. Older apps load this same
 *  web code, and must never request a permission their manifest lacks. */
const SCALE_BUILD = 13;

/**
 * Weigh-ins from a smart scale's app, through Health Connect: a year of them
 * the first time, then the last two weeks on each sync. Days already logged in
 * this app are kept as they are; a weigh-in typed later replaces a scale's.
 */
async function syncScaleWeights(HealthConnect: any, uid: string): Promise<number> {
  const { App } = await import('@capacitor/app');
  if ((Number((await App.getInfo()).build) || 0) < SCALE_BUILD) return 0;
  const has = async () => ((await HealthConnect.checkHealthPermissions({ read: ['Weight'], write: [] })).grantedPermissions ?? []).includes(WEIGHT_PERM);
  if (!(await has())) {
    try { if (localStorage.getItem('hc-weight-asked')) return 0; localStorage.setItem('hc-weight-asked', '1'); } catch { return 0; }
    try { await HealthConnect.requestHealthPermissions({ read: ['Weight'], write: [] }); } catch { /* declined or suppressed */ }
    if (!(await has())) return 0;
  }
  let first = true;
  try { first = !localStorage.getItem('hc-weight-history'); } catch { /* storage disabled */ }
  const records = await readAll(HealthConnect, 'Weight', startOfDaysAgo(first ? 365 : FULL_DAYS).toISOString(), new Date().toISOString());
  const n = await saveScaleRecords(uid, records);
  try { localStorage.setItem('hc-weight-history', new Date().toISOString()); } catch { /* storage disabled */ }
  return n;
}

/**
 * Weigh-ins from Apple Health, in the iPhone app (ios/App/App/Health.swift): a
 * year the first time, then the last two weeks on each sync. Its records come
 * shaped like Health Connect's, so the same rules keep the same days.
 */
async function syncAppleHealthWeights(uid: string): Promise<number> {
  if (!hasPlugin('AppleHealth')) return 0;
  const { registerPlugin } = await import('@capacitor/core');
  let first = true;
  try { first = !localStorage.getItem('ah-weight-history'); } catch { /* storage disabled */ }
  const { records } = await registerPlugin<any>('AppleHealth').weights({ since: startOfDaysAgo(first ? 365 : FULL_DAYS).toISOString() });
  const n = await saveScaleRecords(uid, records);
  try { localStorage.setItem('ah-weight-history', new Date().toISOString()); } catch { /* storage disabled */ }
  return n;
}

/** A phone's weigh-in records, one a day (scaleDays), saved where this app has
 *  none: a year at most, in one request, saved whole or not at all. */
async function saveScaleRecords(uid: string, records: any[]): Promise<number> {
  const have = new Set((await db.table('weights').where('user_id').equals(uid).toArray()).map((w: any) => w.date));
  // This app's own id, asked at runtime (the Play build's differs from the
  // direct download's): it writes typed weigh-ins back to Health Connect and
  // must never read them in again.
  const { App } = await import('@capacitor/app');
  const fresh = scaleDays(records, (await App.getInfo()).id).filter((d) => !have.has(d.date));
  await upsertRecords('weights', fresh.map((d) => ({
    user_id: uid, date: d.date, weight: d.kg, created_at: d.at, source: `health:${d.origin}`,
  })));
  return fresh.length;
}

let _state: HealthConnectState;
healthConnect.subscribe((s) => (_state = s));
function getState(): HealthConnectState {
  return _state;
}

/** True only when running inside the native Android shell. */
export async function isNativeHealth(): Promise<boolean> {
  return !!(await getNative());
}
