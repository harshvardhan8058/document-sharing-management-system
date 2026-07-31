/* eslint-env serviceworker */

/**
 * Offline shell.
 *
 * Deliberately narrow in scope. The rule that matters: **never cache anything
 * under /api**. Documents are access-controlled and the permission model is
 * evaluated per request, so a cached response could serve one user's data to
 * another after a sign-out, or keep serving a document whose share was revoked.
 *
 * Strategies:
 *  - build assets (content-hashed filenames) — cache-first, they never change
 *  - navigations — network-first with the cached shell as the offline fallback
 *  - everything else, /api included — straight to the network, never stored
 */

const VERSION = "dsms-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individual failures must not abort the install.
      .then((cache) => Promise.allSettled(SHELL.map((path) => cache.add(path))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only ever touch same-origin GETs.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache the API, and never cache the event stream.
  if (url.pathname.startsWith("/api/")) return;

  // Hashed build assets are immutable, so a cache hit is always correct.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Navigations: fresh when online, the shell when not.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(async () => (await caches.match("/index.html")) || Response.error())
    );
  }
});
