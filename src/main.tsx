import { Toaster } from "@/components/ui/sonner";
import { InstrumentationProvider } from "@/instrumentation.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, Navigate } from "react-router";
import "./index.css";
import "./types/global.d.ts";

// Auth context
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { BrandingProvider } from "@/lib/branding-context";

// Eager imports — no lazy() for admin pages (avoids Suspense transitions)
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";

// Lazy imports for other pages
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const ContactSelect = lazy(() => import("./pages/ContactSelect"));
const AppLayout = lazy(() => import("./pages/AppLayout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Invoices = lazy(() => import("./pages/Invoices"));
const InvoiceDetail = lazy(() => import("./pages/InvoiceDetail"));
const Profile = lazy(() => import("./pages/Profile"));
const NotFound = lazy(() => import("./pages/NotFound"));

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Verificando sessão...</div>
      </div>
    );
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

const PageFallback = (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-pulse text-muted-foreground">Carregando...</div>
  </div>
);

// ---------------------------------------------------------------------------
// Mount the app
// ---------------------------------------------------------------------------

createRoot(document.getElementById("root")!).render(
  <InstrumentationProvider>
    <ConvexAuthProvider client={convex}>
      <AuthProvider>
        <BrandingProvider>
          <BrowserRouter>
            <RouteSyncer />
            <Routes>
              {/* Public routes — lazy loaded */}
              <Route path="/" element={<Suspense fallback={PageFallback}><Landing /></Suspense>} />
              <Route path="/login" element={<Suspense fallback={PageFallback}><Login /></Suspense>} />
              <Route path="/selecao-contato" element={<Suspense fallback={PageFallback}><ContactSelect /></Suspense>} />

              {/* Admin routes — eagerly imported, NO Suspense */}
              <Route path="/admin" element={<AdminLogin />} />
              <Route path="/admin/dashboard" element={<AdminDashboard />} />

              {/* Protected routes — lazy loaded */}
              <Route
                element={
                  <ProtectedRoute>
                    <Suspense fallback={PageFallback}><AppLayout /></Suspense>
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Suspense fallback={PageFallback}><Dashboard /></Suspense>} />
                <Route path="/faturas" element={<Suspense fallback={PageFallback}><Invoices /></Suspense>} />
                <Route path="/faturas/:id" element={<Suspense fallback={PageFallback}><InvoiceDetail /></Suspense>} />
                <Route path="/perfil" element={<Suspense fallback={PageFallback}><Profile /></Suspense>} />
              </Route>

              {/* 404 */}
              <Route path="*" element={<Suspense fallback={PageFallback}><NotFound /></Suspense>} />
            </Routes>
          </BrowserRouter>
          <Toaster />
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
