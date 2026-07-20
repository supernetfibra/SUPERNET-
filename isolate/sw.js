/**
 * Portal do Cliente — Service Worker
 *
 * Handles push notifications and background sync for the customer portal.
 * Installed when the user grants notification permission.
 */

const CACHE_NAME = "portal-cliente-v1";

// On install — activate immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
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
// Expected payload format (JSON): { title, body, icon, badge, data, requireInteraction }
// Fallback: if payload is empty, show a generic message.
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
    // Actions for the notification
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

  // If there's an action, handle it
  if (event.action === "close") return;

  // Try to focus an existing window/tab, or open a new one
  const promiseChain = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((windowClients) => {
      // Check if there's already a window/tab open with the target URL
      const matchingClient = windowClients.find(
        (client) => client.url.includes(self.location.origin) && "focus" in client
      );

      if (matchingClient) {
        // Navigate the existing client to the target URL
        return matchingClient.focus().then((client) => {
          client.navigate(urlToOpen);
          return client;
        });
      }

      // Open a new window
      return self.clients.openWindow(urlToOpen);
    });

  event.waitUntil(promiseChain);
});

// ---------------------------------------------------------------------------
// Fetch — minimal fetch handler (we don't cache aggressively since this is
// a dynamic portal, but we can serve a fallback page when offline)
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  // Only handle GET requests from same origin
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // For navigation requests (HTML pages), try network first, fallback to cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // If no cache hit and offline, return a simple offline page
          return new Response(
            `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>Sem conexão</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fafafa;color:#1a1a1a;text-align:center;padding:1rem}div{max-width:320px}h1{font-size:1.25rem;margin-bottom:.25rem}p{font-size:.875rem;color:#666}</style>
</head>
<body><div><h1>Sem conexão</h1><p>Verifique sua internet e tente novamente.</p></div></body>
</html>`,
            { headers: { "Content-Type": "text/html; charset=UTF-8" } }
          );
        });
      })
    );
    return;
  }

  // For other static assets, use cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // Cache successful static responses
        if (response.ok && event.request.url.includes(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
