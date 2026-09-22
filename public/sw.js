/**
 * Jesus United — Offline & Notification Service Worker
 *
 * Palette C "Midnight Gethsemane" PWA layer:
 * 1. Precaches the app shell (including the daily audio reflection) so the
 *    liturgy stays readable when the sanctuary has no signal — the daily
 *    scripture payload itself ships as a bundled fallback in the shell.
 * 2. Serves navigations network-first (fresh liturgy when online, cached
 *    shell offline) and static assets cache-first.
 * 3. Receives `push` events for the Diurnal Prayer Watch reminders scheduled
 *    in PrayerWatchModal.tsx and shows quiet, liturgical notifications.
 *
 * Written with `self.*` property access only (no bare service-worker globals)
 * so it lints cleanly under the Next.js ESLint config.
 */
const CACHE_NAME = 'jesus-united-shell-v1';

/** Install-time precache: offline app shell, manifest, icons, daily audio. */
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/audio/daily-reflection.mp3',
];

/** Long-lived, fingerprinted assets served cache-first. */
const CACHE_FIRST_PREFIXES = ['/_next/static/', '/icons/', '/audio/'];

/** Default copy for Prayer Watch pushes (mirrors PrayerWatchModal tone). */
const DEFAULT_WATCH_TITLE = 'Jesus United — Prayer Watch';
const DEFAULT_WATCH_BODY = 'A quiet chime for the hours — it is time for prayer.';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // allSettled: one unreachable asset must not break the whole install.
        Promise.allSettled(
          PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first so believers always receive the freshest
  // liturgy online, falling back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  if (CACHE_FIRST_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(request));
  }
});

/** Cache-first read-through for fingerprinted, long-lived assets. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/** Diurnal Prayer Watch: show quiet push notifications as liturgical chimes. */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title =
    typeof payload.title === 'string' && payload.title
      ? payload.title
      : DEFAULT_WATCH_TITLE;
  const body =
    typeof payload.body === 'string' && payload.body
      ? payload.body
      : DEFAULT_WATCH_BODY;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag:
        typeof payload.tag === 'string' && payload.tag
          ? payload.tag
          : 'jesus-united-prayer-watch',
      data: payload,
    }),
  );
});

/** Tapping a watch notification returns the believer to the altar. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const openWindows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of openWindows) {
        if ('focus' in client) {
          await client.focus();
          return;
        }
      }
      return self.clients.openWindow('/');
    })(),
  );
});