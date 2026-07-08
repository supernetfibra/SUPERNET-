import '@vly-ai/integrations';
import { InstrumentationProvider } from "@/instrumentation.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode, useEffect, createElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, Navigate } from "react-router";
import "./index.css";
import "./types/global.d.ts";

// Auth context
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { BrandingProvider } from "@/lib/branding-context";

// Eager imports — no lazy(), no Suspense around routes.
// This eliminates the React 19 "removeChild" NotFoundError that occurs when
// framer-motion's AnimatePresence (used in VlyToolbar) conflicts with
// React's concurrent reconciliation during Suspense-triggered route transitions.
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import ContactSelect from "./pages/ContactSelect";
import AppLayout from "./pages/AppLayout";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import InvoiceDetail from "./pages/InvoiceDetail";
import Profile from "./pages/Profile";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import NotFound from "./pages/NotFound";

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
          </BrowserRouter>
        </BrandingProvider>
      </AuthProvider>
    </ConvexAuthProvider>
  </InstrumentationProvider>,
);

// ---------------------------------------------------------------------------
// Mount VlyToolbar in a SEPARATE React root.
// ---------------------------------------------------------------------------

(function mountVlyToolbar() {
  const container = document.createElement("div");
  container.id = "vly-toolbar-root";
  document.body.appendChild(container);

  import("../vly-toolbar-readonly.tsx").then(({ VlyToolbar }) => {
    createRoot(container).render(createElement(VlyToolbar));
  });
})();
