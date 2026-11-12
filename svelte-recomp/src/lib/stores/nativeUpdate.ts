// ── IN-APP APK UPDATER (+ one-time migration) ───────────────────────────────
// Two jobs, one banner:
//
//  1. MIGRATE (happens once, for the app everyone already has installed).
//     Old builds were signed with a throwaway key, so the new, stably-signed
//     APK can't install straight over them — Android needs one confirmed
//     replace. We detect an old build by the ABSENCE of the native installer
//     plugin (old APKs don't have it). The prompt's button is a plain link to
//     the APK: the Android WebView opens it in the system browser (no plugin
//     needed on the old app), it downloads, and the user taps Install once.
//     Data lives in Supabase, so it all syncs back on login — nothing is lost.
//
//  2. IN-PLACE (every future update, forever). New builds share one stable
//     signing key, so the native ApkInstaller updates the app in place — a
//     single tap, no uninstall. We know an update exists when the installed
//     build number is behind LATEST_NATIVE_BUILD.
//
// The old app loads its UI live from the web, so shipping this file is what
// actually surfaces the "Reinstall" prompt inside the app people already have.

import { writable } from 'svelte/store';
import { isAndroidApp } from '../platform.ts';

// Keep EQUAL to `versionCode` in android/app/build.gradle. Bump both together
// whenever a native change ships — that's the whole trigger for an in-place
// update prompt.
export const LATEST_NATIVE_BUILD = 24;

// The stable, rolling download link the CI release always publishes to.
export const APK_URL =
  'https://github.com/slimchanceapp/slimchance/releases/download/recompos-app-latest/recompos.apk';

export type UpdateMode = 'none' | 'migrate' | 'inplace';

export interface UpdateState {
  mode: UpdateMode;
  available: boolean;
  installedBuild: number | null;
  latestBuild: number;
  busy: boolean;
  error: string | null;
}

export const updateState = writable<UpdateState>({
  mode: 'none',
  available: false,
  installedBuild: null,
  latestBuild: LATEST_NATIVE_BUILD,
  busy: false,
  error: null,
});

interface NativeBits {
  isNative: boolean;
  hasInstaller: boolean;
  getBuild: () => Promise<number | null>;
  installInPlace: (url: string) => Promise<void>;
}

// Resolve the native bits lazily (same pattern as haptics / Health Connect) so
// nothing touches the Capacitor bridge during prerender.
async function nativeBits(): Promise<NativeBits | null> {
  try {
    const core = await import('@capacitor/core');
    const Capacitor = core.Capacitor;
    const registerPlugin = core.registerPlugin;
    const isNative = isAndroidApp();
    if (!isNative) {
      return {
        isNative: false,
        hasInstaller: false,
        getBuild: async () => null,
        installInPlace: async () => {},
      };
    }

    // Present only in the new, stably-signed build.
    const hasInstaller = !!Capacitor?.isPluginAvailable?.('ApkInstaller');

    const ApkInstaller = registerPlugin<{
      installFromUrl(options: { url: string }): Promise<void>;
    }>('ApkInstaller');

    return {
      isNative: true,
      hasInstaller,
      getBuild: async () => {
        try {
          if (!Capacitor?.isPluginAvailable?.('App')) return null;
          const { App } = await import('@capacitor/app');
          const info = await App.getInfo();
          const n = parseInt(String(info.build), 10);
          return Number.isFinite(n) ? n : null;
        } catch {
          return null;
        }
      },
      installInPlace: (url: string) => ApkInstaller.installFromUrl({ url }),
    };
  } catch {
    return null;
  }
}

/** Decide which (if any) prompt to show. Safe to call anywhere; no-ops off
 *  device. Updates the `updateState` store. */
export async function checkForNativeUpdate(): Promise<void> {
  const bits = await nativeBits();
  if (!bits || !bits.isNative) return;
  // A store build (it loads slimchance.app): the store updates it, and Play's
  // policy forbids offering an APK. Only sideloaded builds load vercel.app.
  if (location.hostname === 'slimchance.app') return;

  // Old build (pre-stable-signing): no installer plugin baked in → this app
  // must be replaced once by the new, properly-signed APK.
  if (!bits.hasInstaller) {
    updateState.update((s) => ({
      ...s,
      mode: 'migrate',
      installedBuild: null,
      available: true,
    }));
    return;
  }

  // New build: offer an in-place update only when actually behind.
  const installedBuild = await bits.getBuild();
  updateState.update((s) => ({
    ...s,
    mode: 'inplace',
    installedBuild,
    latestBuild: LATEST_NATIVE_BUILD,
    available: installedBuild != null && installedBuild < LATEST_NATIVE_BUILD,
  }));
}

/** In-place update for the new, stably-signed builds: hand the APK straight to
 *  the native installer. (The one-time migration path uses a plain download
 *  link instead, since the old app has no installer plugin.) */
export async function installNativeUpdate(): Promise<void> {
  const bits = await nativeBits();
  if (!bits || !bits.isNative || !bits.hasInstaller) return;
  updateState.update((s) => ({ ...s, busy: true, error: null }));
  try {
    await bits.installInPlace(APK_URL);
    // Control now passes to the OS installer; keep busy=true so the button
    // stays disabled behind the system UI.
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    updateState.update((s) => ({ ...s, busy: false, error: msg }));
  }
}

/** Called when the user taps the one-time "Reinstall" link. The <a> handles the
 *  actual navigation/download; this just reflects the busy state + records that
 *  they've started so the copy can switch to "open it and tap Install". */
export function markMigrationStarted(): void {
  updateState.update((s) => ({ ...s, busy: true, error: null }));
}
