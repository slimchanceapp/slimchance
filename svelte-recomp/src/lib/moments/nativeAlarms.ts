// Alarms that fire when the app is CLOSED.
//
// The old path was the service worker's setTimeout + showNotification. On the web
// that is merely unreliable; inside the Capacitor APK it is dead on arrival:
// Android's WebView implements neither the Notifications API nor the Push API, so
// `self.registration.showNotification()` throws and the catch swallows it. On top of
// that the SW's setTimeout only survives while the SW does — Android freezes it
// within minutes of the app going to background — and the scheduler capped delays at
// 24h anyway, so nothing further out was ever armed.
//
// The OS is the only thing that can wake a sleeping phone, so on native we hand the
// schedule to AlarmManager via @capacitor/local-notifications and let Android own it.
// Each alarm/day pair becomes ONE repeating weekly notification, so the schedule
// survives reboots (the plugin registers a BOOT_COMPLETED receiver) and needs no
// re-arming from JS.
//
// Web keeps the service-worker path — see scheduleAlarms() in routes/alarms/+page.svelte.

import { nudgeFireAt, type Nudge } from './situational.ts';
import { isAndroidApp, isNativeApp } from '../platform.ts';

export interface AlarmRow {
  id: string;
  title: string;
  message?: string | null;
  time: string; // "HH:MM"
  days?: number[] | null; // JS getDay(): 0 = Sunday
  enabled?: boolean;
}

/** Android needs its own high-importance channel or alarms arrive silently and
 *  without a heads-up banner — IMPORTANCE_DEFAULT does not wake the screen. */
const CHANNEL_ID = 'recompos-alarms';

// Two independent kinds of notification share one OS queue: the user's own
// repeating alarms, and situational nudges the app decides on. They are
// rescheduled on different triggers, so each must be cancellable without
// touching the other — hence a reserved id range per kind.
const NUDGE_ID_BASE = 2_100_000_000;
const isNudgeId = (id: number) => id >= NUDGE_ID_BASE;
const isAlarmId = (id: number) => id < NUDGE_ID_BASE;

/** Capacitor notification ids must be 32-bit ints, but our alarms are uuids. Hash
 *  (uuid + weekday) to a stable positive int so re-scheduling REPLACES the previous
 *  entry for that slot instead of stacking a duplicate every launch. */
export function notificationId(alarmId: string, day: number): number {
  let h = 5381;
  const s = `${alarmId}:${day}`;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  // Keep alarms strictly below the nudge range, or a hash collision would let an
  // alarm be wiped by a nudge refresh.
  return h % NUDGE_ID_BASE;
}

/** Stable per-nudge-kind id, so re-scheduling replaces rather than stacks. */
export function nudgeNotificationId(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return NUDGE_ID_BASE + (h % 40_000_000);
}

async function cancelRange(LN: any, belongs: (id: number) => boolean): Promise<void> {
  const pending = await LN.getPending();
  const mine = (pending.notifications ?? []).filter((n: any) => belongs(n.id));
  if (mine.length > 0) await LN.cancel({ notifications: mine });
}

export { isNativeApp };

/**
 * Hand the whole alarm list to Android. Returns false when this isn't the native
 * app (or the user refused notification permission), so the caller can fall back to
 * the service-worker path rather than silently scheduling nothing.
 */
export async function scheduleNativeAlarms(alarms: AlarmRow[]): Promise<boolean> {
  const ready = await readyPlugin();
  if (!ready) return false;
  const LocalNotifications = ready.LN;

  try {
    // Clear the ALARM slots we armed last time. Anything still pending that isn't
    // in the new schedule (deleted or disabled alarm) would otherwise keep firing
    // forever. Situational nudges live in a reserved id range and are managed
    // separately, so cancelling one kind must never wipe the other.
    await cancelRange(LocalNotifications, isAlarmId);

    const notifications = [];
    for (const a of alarms) {
      if (!a.enabled || !a.days?.length) continue;
      const [h, m] = a.time.split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue;

      for (const day of a.days) {
        notifications.push({
          id: notificationId(a.id, day),
          title: a.title,
          body: a.message || '',
          channelId: CHANNEL_ID,
          // Weekday is 1-indexed from Sunday in Capacitor; JS getDay() is 0-indexed
          // from Sunday. Off by one here and every alarm fires a day early.
          schedule: { on: { weekday: day + 1, hour: h, minute: m }, allowWhileIdle: true },
        });
      }
    }

    if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
    console.log(`[alarms] armed ${notifications.length} native alarm(s)`);
    return true;
  } catch (e) {
    console.error('[alarms] native scheduling failed:', e);
    return false;
  }
}

/**
 * Permission + channel, once, for both kinds of notification. Returns the plugin
 * when everything the OS needs is in place, or null when this isn't the native
 * app or the user said no — callers must treat null as "schedule nothing".
 */
// NOTE the `{ LN }` wrapper on every return below, and never a bare plugin.
//
// A Capacitor plugin object is a Proxy that turns ANY property access into a
// native method call. Returning one from an `async` function means the runtime
// resolves it with Promise.resolve(), which probes `.then` — the proxy dutifully
// forwards that to Android as a plugin method and the whole call chain dies with
//
//     "LocalNotifications.then() is not implemented"
//
// which is not a permissions problem, a manifest problem, or a plugin-missing
// problem, however much it reads like one. Wrapping it in a plain object keeps
// the proxy off the promise-resolution path.
async function readyPlugin(): Promise<{ LN: any } | null> {
  if (!isNativeApp()) return null;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      console.warn('[alarms] notification permission denied — nothing will fire');
      return null;
    }

    // Android 12+ downgrades us to an INEXACT alarm (delivered whenever the OS feels
    // like it, often 15+ min late) unless exact alarms are allowed. USE_EXACT_ALARM
    // in the manifest auto-grants this on Android 13+; on 12 the user has to allow it,
    // so deep-link them to that settings screen once rather than shipping late alarms.
    try {
      const exact = await LocalNotifications.checkExactNotificationSetting();
      if (exact.exact_alarm === 'prompt') await LocalNotifications.changeExactNotificationSetting();
    } catch { /* older plugin/OS: exact-alarm API absent, nothing to ask for */ }

    // Channels are Android's; on an iPhone the call is unimplemented and would
    // take every reminder down with it.
    if (isAndroidApp()) await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Alarms & reminders',
      description: 'Weigh-ins, meals, training prep',
      importance: 5, // IMPORTANCE_HIGH — heads-up banner + sound
      visibility: 1, // VISIBILITY_PUBLIC — readable on the lock screen
      sound: 'default',
      vibration: true,
    });
    return { LN: LocalNotifications };
  } catch (e) {
    console.error('[alarms] plugin unavailable:', e);
    return null;
  }
}

/**
 * Arm the situational nudges — the ones that know something ("40 g of protein to
 * go and it's 7pm") rather than just knowing the time.
 *
 * Called on every change to today's data. Each call cancels the whole nudge
 * range first, so a nudge is only ever pending while the fact behind it is still
 * true: hit your protein at 18:50 and the 19:00 message is gone before it fires.
 * That is what keeps these honest, and it works because every fact they describe
 * can only change by typing it into this app.
 */
export async function scheduleNudges(nudges: Nudge[], now: Date = new Date()): Promise<boolean> {
  const ready = await readyPlugin();
  if (!ready) return false;
  const LocalNotifications = ready.LN;

  try {
    await cancelRange(LocalNotifications, isNudgeId);

    const notifications = nudges.map((n) => {
      const at = nudgeFireAt(n, now);
      return {
        id: nudgeNotificationId(n.key),
        title: n.title,
        body: n.body,
        channelId: CHANNEL_ID,
        // A one-shot at an absolute time, not a repeat: the message is only true
        // for the day it was computed on.
        schedule: { at, allowWhileIdle: true },
      };
    });

    if (notifications.length > 0) await LocalNotifications.schedule({ notifications });
    console.log(`[alarms] armed ${notifications.length} nudge(s)`);
    return true;
  } catch (e) {
    console.error('[alarms] nudge scheduling failed:', e);
    return false;
  }
}

// ── MORNING BRIEFING AND EVENING HOLD ────────────────────────────────────────
// Not alarms. Android posts each the first time the phone is unlocked inside
// its window (MomentReceiver.java); the iPhone, which tells no app it was
// unlocked, leaves it silently on the lock screen as the window opens
// (ios/App/App/Moments.swift). Both from text this app writes whenever it's
// open (stores/moments.ts). Build 7 carries the Moments plugin; build 6 had a
// morning-only one ("Morning"), still fed here until it's updated. Older
// builds have neither: every call is a no-op and the card asks for the update.

export interface MomentPayload {
  date: string; key: 'morning' | 'evening'; after: number; until: number; title: string; body: string;
  /** The briefing's buttons (build 8+; older builds ignore them). */
  actions?: { weigh: boolean; back: boolean; meal: { label: string; kcal: number; items: unknown[] } | null; weighRange?: [number, number] | null };
}
export interface MomentsState {
  on: boolean; morning?: { shown?: string; postedAt?: number }; evening?: { shown?: string; postedAt?: number };
  /** iPhone only: whether the person let the app notify at all; absent until asked. */
  allowed?: boolean;
}

// Wrapped in { P } for the same reason as readyPlugin(): a bare plugin proxy
// returned from an async function gets probed for .then.
async function momentsPlugin(): Promise<{ P: any; name: 'Moments' | 'Morning' } | null> {
  if (!isNativeApp()) return null;
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    for (const name of ['Moments', 'Morning'] as const) {
      if (Capacitor.isPluginAvailable(name)) return { P: registerPlugin(name), name };
    }
  } catch { /* not the app */ }
  return null;
}

/** 'all' on build 7+, 'morning' on build 6 (no evening hold), null before. */
export async function momentsSupport(): Promise<'all' | 'morning' | null> {
  const p = await momentsPlugin();
  return p ? (p.name === 'Moments' ? 'all' : 'morning') : null;
}

let armedWith = '';

/** Hand the phone the coming moments. Re-sent only when they change, so calling
 *  it on every tick is free. */
export async function armMoments(moments: MomentPayload[]): Promise<void> {
  const key = JSON.stringify(moments);
  if (key === armedWith) return;
  const p = await momentsPlugin();
  if (!p) return;
  armedWith = key;
  try {
    if (p.name === 'Moments') {
      await p.P.arm({ moments });
    } else {
      const morning = moments.filter((m) => m.key === 'morning');
      if (morning.length) await p.P.arm({ after: morning[0].after, briefings: morning.map(({ date, title, body }) => ({ date, title, body })) });
      else await p.P.disarm();
    }
  } catch (e) {
    armedWith = '';
    console.error('[moments] arm failed:', e);
  }
}

export async function disarmMoments(): Promise<void> {
  if (armedWith === 'off') return;
  const p = await momentsPlugin();
  if (!p) return;
  armedWith = 'off';
  try { await p.P.disarm(); } catch (e) { armedWith = ''; console.error('[moments] disarm failed:', e); }
}

/** Post an armed moment now, whatever its window (build 9+): the card's
 *  "Show it now". The titles of the buttons Android was given; throws when it
 *  wasn't shown. */
export async function showMomentNow(date: string, key: 'morning' | 'evening'): Promise<string[]> {
  const p = await momentsPlugin();
  if (!p || p.name !== 'Moments') throw new Error('This needs the app update.');
  return ((await p.P.show({ date, key }))?.buttons ?? []) as string[];
}

export async function momentsStatus(): Promise<MomentsState | null> {
  const p = await momentsPlugin();
  if (!p) return null;
  try {
    const s = await p.P.status();
    // Build 6 reported only the morning, flat.
    return p.name === 'Moments' ? s : { on: s.on, morning: { shown: s.shown, postedAt: s.postedAt } };
  } catch {
    return null;
  }
}

// ── What was entered on the notification ──────────────────────────────────────
// A weight, a back rating or the usual breakfast, from the briefing's buttons
// (build 8+). Android keeps each until the app saves it and says so (ack), so
// nothing is lost to an app that was closed, offline or killed mid-save.

export type MomentInput =
  | { id: string; date: string; at: string; type: 'weight'; kg: number; confirmed?: boolean }
  | { id: string; date: string; at: string; type: 'meal'; items: Array<{ name: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; grams?: number | null }> };

export async function momentsPending(): Promise<MomentInput[]> {
  const p = await momentsPlugin();
  if (!p || p.name !== 'Moments') return [];
  try { return ((await p.P.pending())?.items ?? []) as MomentInput[]; } catch { return []; } // build 7: no queue
}

export async function momentsAck(ids: string[]): Promise<void> {
  const p = await momentsPlugin();
  if (!p || p.name !== 'Moments' || !ids.length) return;
  await p.P.ack({ ids });
}

/** Called the moment a button is pressed while the app is running. */
export async function onMomentsInput(cb: () => void): Promise<() => void> {
  const p = await momentsPlugin();
  if (!p || p.name !== 'Moments') return () => {};
  try {
    const handle = await p.P.addListener('pending', cb);
    return () => handle?.remove?.();
  } catch {
    return () => {};
  }
}

