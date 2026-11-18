/// <reference types="@sveltejs/kit" />
import { build, files, prerendered, version } from '$service-worker';

const CACHE = `recompos-${version}`;
const base = '';
const ASSETS = [...build, ...files, ...prerendered];

self.addEventListener('install', (event) => {
  // Pre-cache the new build's assets, but DO NOT skipWaiting here.
  //
  // Previously this called self.skipWaiting(), so a new deploy activated
  // instantly the moment the app was reopened — which also fired the
  // `activate` handler below that purges the *old* version's cache and
  // claims the page mid-session. If the already-running app then tried to
  // lazy-load an old route chunk (now deleted from both cache and server),
  // the import failed and the app hard-reloaded — which felt like being
  // "kicked out" after every deploy.
  //
  // Now the new worker simply installs and WAITS. The old worker keeps
  // serving the old (still-cached, still-working, still-logged-in) app
  // until the user explicitly taps "Update" in the top bar, which posts
  // SKIP_WAITING (handled below). This is the standard no-surprise-update
  // pattern and is what makes the in-app "update available" badge meaningful.
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;
  if (url.hostname.includes('supabase.co')) return;
  // Never intercept cross-origin requests (e.g. the YouTube video embed's
  // iframe navigation). A service worker registered at our origin's scope
  // WILL otherwise try to intercept iframe navigations too, and substituting
  // our own offline fallback HTML into a video iframe breaks/crashes it.
  if (url.origin !== self.location.origin) return;
  // Where the visitor is right now (food search's market): never a cached answer.
  if (url.pathname === '/where') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/').then((r) => r || new Response('<h1>Offline</h1>', { headers: { 'Content-Type': 'text/html' } }))
      )
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      // Stale-while-revalidate: serve the cached copy instantly (works fully
      // offline), but always kick off a background fetch to refresh the cache
      // whenever there IS a connection (e.g. back on home wifi) so the next
      // visit gets the newer asset. event.waitUntil keeps the SW alive long
      // enough for this background update to actually finish.
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => undefined);

      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      // No cached copy and the network failed too — let this fail as a
      // normal network error instead of faking a 200/empty body, which
      // would otherwise be parsed as a broken/empty JS module and crash
      // whatever tried to import it.
      const res = await network;
      if (res) return res;
      return fetch(req);
    })
  );
});

const localTimers = new Map<string, number>();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'GET_VERSION') {
    // Reply with this worker's build version so the app can show a tiny
    // "you're on the latest build" indicator in the top bar.
    event.ports?.[0]?.postMessage({ version });
    return;
  }
  if (event.data?.type !== 'SCHEDULE_ALARMS') return;

  localTimers.forEach((t) => clearTimeout(t));
  localTimers.clear();

  const now = Date.now();
  (event.data.alarms as Array<{ id: string; title: string; msg: string; fireAt: number }>).forEach((alarm) => {
    const delay = alarm.fireAt - now;
    if (delay <= 0 || delay > 86400000) return;
    const tid = setTimeout(async () => {
      localTimers.delete(alarm.id);
      try {
        await self.registration.showNotification(alarm.title, {
          body: alarm.msg || '',
          icon: base + '/icon-192.png',
          badge: base + '/badge-96.png',
          vibrate: [400, 150, 400, 150, 400, 150, 400],
          tag: `local-${alarm.id}`,
          requireInteraction: true
        });
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) client.postMessage({ type: 'PLAY_ALARM_SOUND', title: alarm.title, body: alarm.msg });
      } catch {}
    }, delay);
    localTimers.set(alarm.id, tid);
  });
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; tag?: string };
  try { payload = event.data.json(); }
  catch { payload = { title: 'Slim Chance', body: event.data.text() }; }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title || 'Slim Chance', {
        body: payload.body || '',
        icon: base + '/icon-192.png',
        badge: base + '/badge-96.png',
        vibrate: [400, 150, 400, 150, 400, 150, 400],
        requireInteraction: true,
        tag: payload.tag || 'recompos',
        data: { url: base },
        actions: [
          { action: 'open', title: 'Open app' },
          { action: 'dismiss', title: 'Dismiss' }
        ]
      }),
      // If the app is already open (foreground or a backgrounded tab),
      // also tell it to play the alarm melody -- the system notification
      // sound alone is a short, generic ping; this gives a fuller,
      // more "alarm-like" alert whenever the page is actually running.
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage({ type: 'PLAY_ALARM_SOUND', title: payload.title, body: payload.body });
      })
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes('/') && 'focus' in c) {
          c.postMessage({ type: 'PLAY_ALARM_SOUND', title: event.notification.title });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
