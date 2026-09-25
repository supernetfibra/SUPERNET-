import { Toaster } from "@/components/ui/sonner";
import { InstrumentationProvider, installRemoveChildDiagnostic } from "@/instrumentation.tsx";
import { registerDiagnostics } from "@/lib/diagnostics";
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

// Auth context
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { BrandingProvider } from "@/lib/branding-context";

// Billing context (centralized fetch with periodic refetch)
import { BillingProvider } from "@/lib/billing-context";

// Theme provider
import { ThemeProvider } from "@/lib/theme-provider";

// Error boundary for graceful crash handling
import { ErrorBoundary } from "@/components/error-boundary";

// Update notification (detects new deploys)
import { UpdateNotification } from "@/components/update-notification";

// Service Worker registration
const SW_PATH = "/sw.js";

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  // Don't register in development
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1" ||
    window.location.hostname === "0.0.0.0"
  ) {
    console.log("[SW] Skipping registration in development mode.");
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .then((registration) => {
        console.log("[SW] Registered:", registration.scope);
        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                console.log("[SW] New version available — reload to update.");
              }
            });
          }
        });
      })
      .catch((err) => console.warn("[SW] Registration failed:", err));

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      console.log("[SW] Controller changed — new version active.");
    });
  });
}

registerServiceWorker();

// All pages are lazy-loaded for optimal code splitting.
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const AdminLayout = lazy(() => import("./pages/AdminLayout"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminInstallRequests = lazy(() => import("./pages/AdminInstallRequests"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminSimulator = lazy(() => import("./pages/AdminSimulator"));
const AdminOutbox = lazy(() => import("./pages/AdminOutbox"));
const AppLayout = lazy(() => import("./pages/AppLayout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Invoices = lazy(() => import("./pages/Invoices"));
const InvoiceDetail = lazy(() => import("./pages/InvoiceDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));

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

installRemoveChildDiagnostic();
registerDiagnostics();

createRoot(document.getElementById("root")!).render(
  <InstrumentationProvider>
      <AuthProvider>
        <BrandingProvider>
          <ThemeProvider>
          <BillingProvider>
          <UpdateNotification />
          <BrowserRouter>
            <RouteSyncer />
            <ErrorBoundary>
            <Routes>
              {/* Public routes — lazy loaded */}
              <Route path="/" element={<Suspense fallback={<PageSpinner />}><Landing /></Suspense>} />
              <Route path="/login" element={<Suspense fallback={<PageSpinner />}><Login /></Suspense>} />
              <Route path="/termos" element={<Suspense fallback={<PageSpinner />}><TermsOfUse /></Suspense>} />
              <Route path="/privacidade" element={<Suspense fallback={<PageSpinner />}><PrivacyPolicy /></Suspense>} />

              {/* Admin routes — now lazy-loaded (reduces initial bundle) */}
              <Route path="/admin" element={<Suspense fallback={<PageSpinner />}><AdminLogin /></Suspense>} />
              <Route
                element={
                  <ProtectedRoute>
                    <Suspense fallback={<AppLayoutSkeleton />}><AdminLayout /></Suspense>
                  </ProtectedRoute>
                }
              >
                <Route path="/admin/dashboard" element={<Suspense fallback={<DashboardSkeleton />}><AdminDashboard /></Suspense>} />
                <Route path="/admin/install-requests" element={<Suspense fallback={<InvoicesSkeleton />}><AdminInstallRequests /></Suspense>} />
                <Route path="/admin/outbox" element={<Suspense fallback={<DashboardSkeleton />}><AdminOutbox /></Suspense>} />
                <Route path="/admin/settings" element={<Suspense fallback={<DashboardSkeleton />}><AdminSettings /></Suspense>} />
                <Route path="/admin/simulator" element={<Suspense fallback={<DashboardSkeleton />}><AdminSimulator /></Suspense>} />
              </Route>

              {/* Protected routes — lazy loaded */}
              <Route
                element={
                  <ProtectedRoute>
                    <Suspense fallback={<AppLayoutSkeleton />}><AppLayout /></Suspense>
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Suspense fallback={<DashboardSkeleton />}><Dashboard /></Suspense>} />
                <Route path="/faturas" element={<Suspense fallback={<InvoicesSkeleton />}><Invoices /></Suspense>} />
                <Route path="/faturas/:id" element={<Suspense fallback={<InvoiceDetailSkeleton />}><InvoiceDetail /></Suspense>} />
                <Route path="/perfil" element={<Suspense fallback={<ProfileSkeleton />}><Profile /></Suspense>} />
              </Route>

              {/* 404 */}
              <Route path="*" element={<Suspense fallback={<PageSpinner />}><NotFound /></Suspense>} />
            </Routes>
            </ErrorBoundary>
          </BrowserRouter>
          <Toaster />
          </BillingProvider>
          </ThemeProvider>
        </BrandingProvider>
      </AuthProvider>
  </InstrumentationProvider>,
);

// ---------------------------------------------------------------------------
// Mount VlyToolbar in a completely separate React root AFTER the main app.
// ---------------------------------------------------------------------------
(function mountVlyToolbar() {
  const isVlyDev =
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".vly.sh") &&
    window.self === window.top;

  if (!isVlyDev) return;

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
