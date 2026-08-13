/**
 * OBOLO service worker.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE: NOTHING AUTHENTICATED IS EVER CACHED.
 * ---------------------------------------------------------------------------
 * Every page in this app is personalised. The `public.v_*` views mask cost with
 * `is_owner()`, so an owner's HTML and a staff member's HTML for the same URL
 * differ in exactly the field the whole `core` schema exists to hide. A service
 * worker cache is shared across a browser profile, not scoped to a session --
 * so caching a rendered page on the shop tablet would survive a sign-out and
 * serve the owner's cost figures to whoever signed in next.
 *
 * Therefore this worker caches ONLY content-addressed static assets, which
 * contain no user data by construction. Documents, RSC payloads and API calls
 * go to the network every time, exactly as before.
 *
 * That is a deliberate ceiling on what this can do. It makes the app's
 * *resources* local and its failures graceful; it does not make a signed-in
 * page appear without the network. Doing that safely needs the data layer to
 * move to the device with the masking applied at sync time, which is a later
 * stage of the plan, not a tweak to this file.
 *
 * No build step, no Workbox, no precache manifest: Next's static assets are
 * content-hashed and immutable, so caching them as they are requested is both
 * simpler and equivalent. The only thing precached at install is the offline
 * page, which is static and public.
 */

const VERSION = "v1";
const ASSETS = `obolo-assets-${VERSION}`;
const SHELL = `obolo-shell-${VERSION}`;
const KEEP = new Set([ASSETS, SHELL]);

const OFFLINE_URL = "/offline";

/** Immutable, content-addressed, and free of user data. Safe to keep. */
function isCacheableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname === "/manifest.webmanifest") return true;
  return /\.(?:woff2|woff|ttf|otf|css|js|svg|png|jpg|jpeg|gif|webp|ico)$/.test(url.pathname);
}

/**
 * Anything that can carry a person's data, or that must reflect the server's
 * current answer. Never touched.
 */
function isNeverCached(url, request) {
  if (url.pathname.startsWith("/api/")) return true;
  if (request.mode === "navigate") return true;
  // React Server Component payloads: the same personalised render, in another
  // wire format. Serving a stale one also desynchronises the router.
  if (url.searchParams.has("_rsc")) return true;
  if (request.headers.get("RSC") === "1") return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.add(new Request(OFFLINE_URL, { cache: "reload" }));
      // Take over promptly: this worker only ever adds asset caching, so there
      // is no half-migrated state for an in-flight page to fall into.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.has(n)).map((n) => caches.delete(n)));

      // Lets the browser start the network request for a navigation while this
      // worker is still booting, so the worker never adds latency to a page load.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (isNeverCached(url, request)) {
    // Navigations still get an answer when the line is down: the app's own
    // offline page, rather than the browser's error screen.
    if (request.mode === "navigate") {
      event.respondWith(
        (async () => {
          try {
            const preloaded = await event.preloadResponse;
            if (preloaded) return preloaded;
            return await fetch(request);
          } catch {
            const shell = await caches.open(SHELL);
            const offline = await shell.match(OFFLINE_URL);
            return (
              offline ??
              new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
            );
          }
        })(),
      );
    }
    return;
  }

  if (!isCacheableAsset(url)) return;

  // Cache-first. Content-hashed URLs cannot go stale: a changed file is a
  // changed URL, so a hit is always correct and a miss is always a new asset.
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(request);
      if (hit) return hit;

      try {
        const response = await fetch(request);
        if (response.ok && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        // A miss with no network. Nothing sensible to substitute for a script
        // or a font, so let it fail the way it would have without this worker.
        throw error;
      }
    })(),
  );
});

/**
 * Sign-out clears everything this worker holds.
 *
 * Assets carry no user data, so this is belt-and-braces rather than a fix for a
 * known leak -- but "the cache is emptied when a person signs out" is a much
 * easier property to keep true over time than "the cache never happened to
 * contain anything personal".
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "OBOLO_SIGN_OUT") {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))));
  }
});
