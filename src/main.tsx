import { Toaster } from "@/components/ui/sonner";
import { InstrumentationProvider } from "@/instrumentation.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, Navigate } from "react-router";
import "./index.css";
import "./types/global.d.ts";

// Skeleton components for Suspense fallbacks
import {
  PageSpinner,
  AuthSpinner,
  AppLayoutSkeleton,
  DashboardSkeleton,
  InvoicesSkeleton,
  InvoiceDetailSkeleton,
  ProfileSkeleton,
} from "@/components/skeletons";

// Smooth transition wrapper — prevents flash when Suspense swaps fallback → content
import { SmoothAppear } from "@/components/smooth-appear";

// Auth context
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { BrandingProvider } from "@/lib/branding-context";

// Billing context (centralized fetch with periodic refetch)
import { BillingProvider } from "@/lib/billing-context";

// Theme provider
import { ThemeProvider } from "@/lib/theme-provider";

// Service Worker registration
const SW_PATH = "/sw.js";

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  // Register on page load with a small delay to not block rendering
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .then((registration) => {
        console.log("[SW] Registered:", registration.scope);

        // If there's a waiting SW, activate it immediately
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        // Handle updates — when a new SW is found, reload to activate
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                // New content is available, offer update
                console.log("[SW] New version available — reload to update.");
              }
            });
          }
        });
      })
      .catch((err) => console.warn("[SW] Registration failed:", err));

    // When a new SW takes over, reload the page for consistency
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      console.log("[SW] Controller changed — reloading.");
      window.location.reload();
    });
  });
}

registerServiceWorker();

// All pages are lazy-loaded for optimal code splitting.
// Admin pages were previously eager but are on obscure routes (/admin,*)
// and contain heavy components (Select, icons, complex forms).
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AppLayout = lazy(() => import("./pages/AppLayout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Invoices = lazy(() => import("./pages/Invoices"));
const InvoiceDetail = lazy(() => import("./pages/InvoiceDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));

const convexUrl = import.meta.env.VITE_CONVEX_URL || 'https://small-sparrow-797.convex.cloud';
const convex = new ConvexReactClient(convexUrl);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <AuthSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

// ---------------------------------------------------------------------------
// Mount the app
// ---------------------------------------------------------------------------

createRoot(document.getElementById("root")!).render(
  <InstrumentationProvider>
    <ConvexAuthProvider client={convex}>
      <AuthProvider>
        <BrandingProvider>
          <ThemeProvider>
          <BillingProvider>
          <BrowserRouter>
            <RouteSyncer />
            <Routes>
              {/* Public routes — lazy loaded */}
              <Route path="/" element={<Suspense fallback={<PageSpinner />}><SmoothAppear><Landing /></SmoothAppear></Suspense>} />
              <Route path="/login" element={<Suspense fallback={<PageSpinner />}><SmoothAppear><Login /></SmoothAppear></Suspense>} />

              {/* Admin routes — now lazy-loaded (reduces initial bundle) */}
              <Route path="/admin" element={<Suspense fallback={<PageSpinner />}><SmoothAppear><AdminLogin /></SmoothAppear></Suspense>} />
              <Route path="/admin/dashboard" element={<Suspense fallback={<PageSpinner />}><SmoothAppear><AdminDashboard /></SmoothAppear></Suspense>} />

              {/* Protected routes — lazy loaded */}
              <Route
                element={
                  <ProtectedRoute>
                    <Suspense fallback={<AppLayoutSkeleton />}><SmoothAppear><AppLayout /></SmoothAppear></Suspense>
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Suspense fallback={<DashboardSkeleton />}><SmoothAppear><Dashboard /></SmoothAppear></Suspense>} />
                <Route path="/faturas" element={<Suspense fallback={<InvoicesSkeleton />}><SmoothAppear><Invoices /></SmoothAppear></Suspense>} />
                <Route path="/faturas/:id" element={<Suspense fallback={<InvoiceDetailSkeleton />}><SmoothAppear><InvoiceDetail /></SmoothAppear></Suspense>} />
                <Route path="/perfil" element={<Suspense fallback={<ProfileSkeleton />}><SmoothAppear><Profile /></SmoothAppear></Suspense>} />
              </Route>

              {/* 404 */}
              <Route path="*" element={<Suspense fallback={<PageSpinner />}><SmoothAppear><NotFound /></SmoothAppear></Suspense>} />
            </Routes>
          </BrowserRouter>
          <Toaster />
          </BillingProvider>
          </ThemeProvider>
        </BrandingProvider>
      </AuthProvider>
    </ConvexAuthProvider>
  </InstrumentationProvider>,
);

// ---------------------------------------------------------------------------
// Mount VlyToolbar in a completely separate React root AFTER the main app.
// Uses a dynamic import + deferred mount to avoid interfering with the main
// app's React instance during initial render.
// ---------------------------------------------------------------------------
(function mountVlyToolbar() {
  const isVlyDev =
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".vly.sh") &&
    window.self === window.top;

  if (!isVlyDev) return;

  // Defer to avoid any module-resolution conflicts during initial render
  setTimeout(async () => {
    try {
      const { createElement } = await import("react");
      const { createRoot: createVlyRoot } = await import("react-dom/client");
      const { VlyToolbar } = await import("../vly-toolbar-readonly.tsx");

      const container = document.createElement("div");
      container.id = "vly-toolbar-root";
      document.body.appendChild(container);

      createVlyRoot(container).render(createElement(VlyToolbar));
    } catch (e) {
      console.warn("[Vly] Failed to mount toolbar:", e);
    }
  }, 500);
})();
