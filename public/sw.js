/**
 * Portal do Cliente — Service Worker
 *
 * Handles:
 * - Push notifications
 * - Offline fallback for navigation requests
 * - Cache-first for all GET requests (including cross-origin content
 *   like provider logos that are explicitly cached by the app)
 * - Precache of core pages at install time for basic offline functionality
 */

const CACHE_NAME = "portal-cliente-v1";

// ── Precache these URLs at install time ────────────────────────────────
// These are fetched and cached when the SW is first installed, ensuring
// the app shell and login page work even without connectivity.
// JS/CSS chunks are auto-cached by the fetch handler during online browsing.
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/login",
  "/dashboard",
  "/faturas",
  "/perfil",
  "/logo-192.png",
  "/logo-512.png",
  "/manifest.webmanifest",
];

async function precacheAssets(urls) {
  const cache = await caches.open(CACHE_NAME);
  // Remove inner try/catch so Promise.allSettled sees actual rejections.
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        return true;
      }
      console.warn("[SW] Precache failed (status", response.status, "):", url);
      return false;
    }),
  );
  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value === true,
  ).length;
  console.log("[SW] Precache complete:", succeeded, "/", urls.length);
}

// On install — activate immediately + precache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([self.skipWaiting(), precacheAssets(PRECACHE_URLS)]),
  );
});

// On activate — claim all clients so the SW controls pages immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean old caches if needed
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((n) => n !== CACHE_NAME)
            .map((n) => caches.delete(n))
        )
      ),
    ])
  );
});

// ---------------------------------------------------------------------------
// Push event — receive a push message and show a notification
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    data = null;
  }

  const title = data?.title || "Portal do Cliente";
  const options = {
    body: data?.body || "Você tem uma nova notificação.",
    icon: data?.icon || "/logo-192.png",
    badge: data?.badge || "/logo-192.png",
    vibrate: [200, 100, 200],
    tag: data?.tag || "default",
    renotify: data?.renotify ?? true,
    requireInteraction: data?.requireInteraction ?? true,
    data: data?.data || {},
    actions: data?.actions || [
      { action: "open", title: "Abrir" },
      { action: "close", title: "Fechar" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------------------
// Notification click — handle user interaction with the notification
// ---------------------------------------------------------------------------
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen =
    event.notification.data?.url || event.notification.data?.path || "/dashboard";

  if (event.action === "close") return;

  const promiseChain = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((windowClients) => {
      const matchingClient = windowClients.find(
        (client) => client.url.includes(self.location.origin) && "focus" in client
      );

      if (matchingClient) {
        return matchingClient.focus().then((client) => {
          client.navigate(urlToOpen);
          return client;
        });
      }

      return self.clients.openWindow(urlToOpen);
    });

  event.waitUntil(promiseChain);
});

// ---------------------------------------------------------------------------
// Fetch — adaptive strategy based on request type.
//
// Strategies:
//   API requests (/api/*)         → Network-first (fresh data when online,
//                                    cached response when offline).
//   Navigation requests           → Network-first with offline page fallback.
//   All other (assets, images)    → Cache-first (instant from cache,
//                                    fallback to network).
//
// All strategies auto-cache successful same-origin GET responses so the
// next visit works even without connectivity.
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(handleFetch(event.request));
});

async function handleFetch(request) {
  const url = new URL(request.url);
  const isSameOrigin = request.url.startsWith(self.location.origin);
  const isApiPath = url.pathname.startsWith("/api/");

  // ── API requests: network-first ──────────────────────────────────────
  // Always try the network first so the user sees fresh data.
  // When offline, fall back to the cached response.
  if (isApiPath) {
    try {
      const response = await fetch(request);
      if (response.ok && isSameOrigin) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      return new Response(
        JSON.stringify({ error: "Sem conexão", billings: [] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  // ── Non-API, non-navigation: cache-first ─────────────────────────────
  // Static assets, images, etc. — serve from cache instantly.
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && isSameOrigin) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  } catch {
    // Offline and not in cache
    if (request.mode === "navigate") {
      return offlinePage();
    }
    return new Response("", { status: 503, statusText: "Service Unavailable" });
  }
}

function offlinePage() {
  return new Response(
    `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Sem conexão</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fafafa;color:#1a1a1a;text-align:center;padding:1rem}div{max-width:320px}h1{font-size:1.25rem;margin-bottom:.25rem}p{font-size:.875rem;color:#666}</style>
</head>
<body><div><h1>Sem conexão</h1><p>Verifique sua internet e tente novamente.</p></div></body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=UTF-8" } },
  );
}

