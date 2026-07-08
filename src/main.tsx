import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { InstrumentationProvider } from "@/instrumentation.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode, useEffect, lazy, Suspense, createElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, Navigate } from "react-router";
import "./index.css";
import "./types/global.d.ts";

// Auth context
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { BrandingProvider } from "@/lib/branding-context";

// Lazy load pages
const Landing = lazy(() => import("./pages/Landing.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const ContactSelect = lazy(() => import("./pages/ContactSelect.tsx"));
const AppLayout = lazy(() => import("./pages/AppLayout.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Invoices = lazy(() => import("./pages/Invoices.tsx"));
const InvoiceDetail = lazy(() => import("./pages/InvoiceDetail.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const AdminLogin = lazy(() => import("./pages/AdminLogin.tsx"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

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

// ---------------------------------------------------------------------------
// Mount the main app
// ---------------------------------------------------------------------------

createRoot(document.getElementById("root")!).render(
  <InstrumentationProvider>
    <ConvexAuthProvider client={convex}>
      <AuthProvider>
        <BrandingProvider>
          <BrowserRouter>
            <RouteSyncer />
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/selecao-contato" element={<ContactSelect />} />
                <Route path="/admin" element={<AdminLogin />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />

                {/* Protected routes */}
                <Route
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/faturas" element={<Invoices />} />
                  <Route path="/faturas/:id" element={<InvoiceDetail />} />
                  <Route path="/perfil" element={<Profile />} />
                </Route>

                {/* 404 */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster />
        </BrandingProvider>
      </AuthProvider>
    </ConvexAuthProvider>
  </InstrumentationProvider>,
);

// ---------------------------------------------------------------------------
// Mount VlyToolbar in a SEPARATE React root.
//
// VlyToolbar uses framer-motion's AnimatePresence which manipulates the DOM
// in ways that conflict with React 19's reconciliation during route
// transitions. By rendering it in its own root, its DOM operations are
// completely isolated from the main app's reconciliation — preventing the
// "removeChild" NotFoundError.
// ---------------------------------------------------------------------------

(function mountVlyToolbar() {
  const container = document.createElement("div");
  container.id = "vly-toolbar-root";
  document.body.appendChild(container);

  // Lazy-import so the chunk is loaded asynchronously and doesn't block the
  // main app's initial render.
  import("../vly-toolbar-readonly.tsx").then(({ VlyToolbar }) => {
    createRoot(container).render(createElement(VlyToolbar));
  });
})();
