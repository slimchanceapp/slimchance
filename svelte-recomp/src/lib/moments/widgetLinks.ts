// The home-screen widget's Scan and Photo open the app at the food logger
// (build 23+, SlimWidget.java). Loaded only on Android and after the first
// screen (+layout.svelte imports it when needed), so it costs the first screen
// nothing.

/** Where a widget button opens the app: slimchance://food/scan and
 *  slimchance://food/photo go to the food logger, ready. Null for anything else. */
export function widgetRoute(url: string | null | undefined): string | null {
  const m = /^slimchance:\/\/food\/(scan|photo)$/.exec(url ?? '');
  return m ? `/recipes?add=${m[1]}` : null;
}

/** Follow widget links: the one the app was launched with (once: it stays for
 *  the app's whole run), then each one while the app is open. Returns the stop. */
export async function followWidgetLinks(go: (to: string) => void): Promise<() => void> {
  const { App } = await import('@capacitor/app');
  const open = (url?: string) => { const to = widgetRoute(url); if (to) go(to); };
  const launch = (await App.getLaunchUrl())?.url;
  try {
    if (launch && sessionStorage.getItem('widget-launch') !== launch) { sessionStorage.setItem('widget-launch', launch); open(launch); }
  } catch { /* storage off: the launch link is skipped */ }
  const h = await App.addListener('appUrlOpen', (e) => open(e.url));
  return () => { void h.remove(); };
}
