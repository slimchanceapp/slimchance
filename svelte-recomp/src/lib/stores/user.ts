import { derived, writable } from 'svelte/store';
import { supabase } from '$lib/db/client';
import type { User } from '@supabase/supabase-js';

export const user = writable<User | null>(null);
export const userId = writable<string>('');
export const authReady = writable(false);

let initPromise: Promise<void> | null = null;

/** A trial: started with "Start now", no email yet (Supabase anonymous
 *  sign-in). Everything works the same; it just lives on this one device until
 *  it's saved, and it's deleted after 30 days unused. */
export const isTrial = derived(user, ($u) => !!$u?.is_anonymous);

// Email/password accounts, so the SAME account can be used on several devices
// and their data stays in sync. A trial becomes one in place (saveAccount):
// same user id, nothing moves.
export async function initAuth() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      user.set(session.user);
      userId.set(session.user.id);
    }

    supabase.auth.onAuthStateChange((_event, s) => {
      user.set(s?.user ?? null);
      userId.set(s?.user?.id ?? '');
    });

    authReady.set(true);
  })();

  return initPromise;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** The version of the privacy page a consent was given to (static/privacy.html). */
export const PRIVACY_VERSION = '2026-10-31';

/** Creating an account needs explicit consent to keeping health data (GDPR
 *  Art. 9); it's recorded on the account itself, so it can be shown later. */
export async function signUp(email: string, password: string, consent: boolean) {
  if (!consent) throw new Error('Tick the box to agree, or Slim Chance can’t keep your data.');
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { consent: { health: true, privacy: PRIVACY_VERSION, at: new Date().toISOString() } } },
  });
  if (error) throw error;
}

/** "Start now": try Slim Chance without an email. Consent is still explicit, and
 *  recorded the same way as at sign-up. */
export async function startTrial(consent: boolean) {
  if (!consent) throw new Error('Tick the box to agree, or Slim Chance can’t keep your data.');
  const { error } = await supabase.auth.signInAnonymously({
    options: { data: { consent: { health: true, privacy: PRIVACY_VERSION, at: new Date().toISOString() } } },
  });
  if (error) throw error;
}

/** Turn a trial into an email account, in place. The project confirms emails
 *  automatically, so this needs no email to arrive (verified live: the user
 *  stops being anonymous and can sign in with the password at once). */
export async function saveAccount(email: string, password: string) {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) throw new Error('That doesn’t look like an email address.');
  if (password.length < 8) throw new Error('Use at least 8 characters for the password.');
  const { data, error } = await supabase.auth.updateUser({ email: email.trim(), password });
  if (error) throw error;
  if (data.user) user.set(data.user);
}

/** Settings → Delete my account. The server deletes the account and all of it
 *  (supabase/functions/delete-account); then nothing of it stays on this
 *  device: its notifications are disarmed, the offline copy and the local
 *  settings are wiped, and the app starts clean. */
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'delete' } });
  if (error || !data?.deleted) {
    let msg = data?.error as string | undefined;
    try { msg ??= (await (error as any)?.context?.json())?.error; } catch { /* no body */ }
    throw new Error(msg || 'Could not delete the account. Nothing was lost; try again.');
  }
  const { scheduleNativeAlarms, scheduleNudges, disarmMoments } = await import('$lib/nativeAlarms');
  await Promise.allSettled([scheduleNativeAlarms([]), scheduleNudges([]), disarmMoments()]);
  const { default: db } = await import('$lib/db/dexie');
  db.close();
  await db.delete().catch(() => {});
  try { localStorage.clear(); } catch { /* storage disabled */ }
  await supabase.auth.signOut().catch(() => {});
  location.replace('/');
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getUserId(): Promise<string> {
  const uid = await new Promise<string>((resolve) => {
    const unsub = userId.subscribe((v) => {
      if (v) { unsub(); resolve(v); }
    });
  });
  return uid;
}

