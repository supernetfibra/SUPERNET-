/**
 * Portal do Cliente — Service Worker
 *
 * Handles:
 * - Push notifications
 * - Offline fallback for navigation requests
 * - Network-first for HTML/navigation (always gets latest version)
 * - Cache-first for static assets (fast loading)
 * - Auto-update detection via /version.json (written at build time)
 */

// ── !! KEEP IN SYNC with src/lib/cache-config.ts !! ───────────────────
const CACHE_NAME = "portal-cliente-v4";

// ── Precache these URLs at install time ────────────────────────────────
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/login",
  "/logo-192.png",
  "/logo-512.png",
  "/manifest.webmanifest",
];

async function precacheAssets(urls) {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url);
      if (response.ok) {
        await cache.put(url, response);
        return true;
      }
      return false;
    }),
  );
  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value,
  ).length;
  console.log(
    `[SW] Precached ${succeeded}/${urls.length} assets into ${CACHE_NAME}`,
  );
}

// ── Message handler — force update check from frontend ─────────────────
// When the frontend sends { type: "CHECK_UPDATE" }, the SW fetches
// /version.json and compares with the stored version. If different,
// it tells all clients to reload.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CHECK_UPDATE") {
    checkForUpdate();
  }
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function checkForUpdate() {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) return;
    const { version } = await response.json();

    const currentVersion = await getVersionFromCache();

    if (currentVersion && version !== currentVersion) {
      console.log(
        "[SW] New version detected:",
        version,
        "(was:",
        currentVersion + ")",
      );
      // Notify all clients that a new version is available
      const clients = await self.clients.matchAll();
      for (const client of clients) {
        client.postMessage({ type: "NEW_VERSION", version });
      }
    }

    // Store the new version
    await storeVersion(version);
  } catch (err) {
    console.warn("[SW] Update check failed:", err);
  }
}

async function getVersionFromCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match("/version.json");
    if (response) {
      const data = await response.json();
      return data.version;
    }
  } catch {}
  return null;
}

async function storeVersion(version) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = new Response(JSON.stringify({ version }), {
      headers: { "Content-Type": "application/json" },
    });
    await cache.put("/version.json", response);
  } catch {}
}

// ── Push notification ──────────────────────────────────────────────────
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlToOpen =
    event.notification.data?.url || event.notification.data?.path || "/dashboard";

  if (event.action === "close") return;

  const promiseChain = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((windowClients) => {
      const matchingClient = windowClients.find(
        (client) => client.url.includes(self.location.origin) && "focus" in client,
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
//   Navigation (HTML)         → Network-first (always gets latest deploy)
//   Static assets             → Cache-first (fast, versioned by Vite hash)
//   Cross-origin API calls    → Passed straight through (no caching — the
//                               browser handles CORS; caching a cross-origin
//                               opaque response would corrupt JSON handling)
//   /version.json             → Never cached (always fresh)
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(handleFetch(event.request));
});

async function handleFetch(request) {
  const url = new URL(request.url);
  const isSameOrigin = request.url.startsWith(self.location.origin);
  const isNavigation = request.mode === "navigate";

  // ── /version.json — never cache, always fresh ───────────────────────
  if (isSameOrigin && url.pathname === "/version.json") {
    return fetch(request);
  }

  // ── Cross-origin (Supabase API) — pass through untouched ────────────
  if (!isSameOrigin) {
    return fetch(request);
  }

  // ── Same-origin API paths (legacy) — network-first ──────────────────
  if (url.pathname.startsWith("/api/")) {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      return new Response(JSON.stringify({ error: "Sem conexão" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ── Navigation requests: network-first (gets latest HTML on every navigation) ──
  if (isNavigation) {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
      }
      return response;
    } catch {
      // Offline — try cache, then fallback
      const cached = await caches.match(request);
      if (cached) return cached;
      return offlinePage();
    }
  }

  // ── Static assets: cache-first (Vite hashes filenames, so new = new URL) ──
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
    }
    return response;
  } catch {
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
