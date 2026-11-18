// Which shell this page is running in: the Android app, the iPhone app, or a
// browser. Asked here and nowhere else (selfcheck holds every other file to it),
// so a new platform is one change, not a hunt through seven files.
//
// The native shells inject window.Capacitor before the page's code runs, so the
// global answers synchronously; a plain browser has none, or a web stand-in that
// says it isn't native.
export type Platform = 'android' | 'ios' | 'web';

/** Pass `cap` to ask about a Capacitor object you already hold. */
export function platform(cap: any = (globalThis as any).Capacitor): Platform {
  if (!cap?.isNativePlatform?.()) return 'web';
  const p = cap.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : 'web';
}

export const isNativeApp = (): boolean => platform() !== 'web';
/** Android-only parts: Health Connect, the APK updater, the unlock moments. */
export const isAndroidApp = (): boolean => platform() === 'android';
export const isIOSApp = (): boolean => platform() === 'ios';

/** A native plugin this installed build actually ships; older builds lack newer ones. */
export function hasPlugin(name: string): boolean {
  return !!(globalThis as any).Capacitor?.isPluginAvailable?.(name);
}

/** The Google Play build (app.slimchance), not the GitHub APK
 *  (com.toxicminds.recompos): Play's closed test needs 12 testers. */
export async function isPlayApp(): Promise<boolean> {
  if (!isAndroidApp()) return false;
  try {
    const { App } = await import('@capacitor/app');
    return (await App.getInfo()).id === 'app.slimchance';
  } catch {
    return false;
  }
}
