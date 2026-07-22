/**
 * Skeleton Components — Loading placeholders that mirror each page's layout.
 *
 * Used as Suspense fallbacks so the user sees a structural skeleton during
 * lazy-load transitions instead of a blank screen or generic spinner.
 */

import { useLocation } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Generic centered spinner (Landing, Login, Admin, NotFound)
// ---------------------------------------------------------------------------

export function PageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
        <p className="text-sm text-muted-foreground animate-pulse">Carregando...</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth-check spinner (shown by ProtectedRoute while verifying session)
// ---------------------------------------------------------------------------

export function AuthSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
        <p className="text-sm text-muted-foreground animate-pulse">Verificando sessão...</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App Layout skeleton — sidebar + main area
// The sidebar is shown as a static structural placeholder so the layout
// doesn't jump when the real AppLayout mounts.
// Uses useLocation() to render the correct content skeleton for the
// current route (Dashboard, Faturas, Fatura Detalhe, ou Perfil).
// ---------------------------------------------------------------------------

export function AppLayoutSkeleton() {
  const location = useLocation();
  const pathname = location.pathname;

  // Pick the skeleton that matches the current route
  let ContentSkeleton:
    | typeof DashboardSkeleton
    | typeof InvoicesSkeleton
    | typeof InvoiceDetailSkeleton
    | typeof ProfileSkeleton = DashboardSkeleton;

  if (pathname.startsWith("/faturas/")) {
    ContentSkeleton = InvoiceDetailSkeleton;
  } else if (pathname.startsWith("/faturas")) {
    ContentSkeleton = InvoicesSkeleton;
  } else if (pathname.startsWith("/perfil")) {
    ContentSkeleton = ProfileSkeleton;
  }

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar — hidden on mobile (matches real AppLayout behavior) */}
      <aside className="hidden md:flex w-64 border-r border-border bg-card flex-col">
        {/* Logo */}
        <div className="h-14 flex items-center gap-2 px-5 border-b border-border">
          <div className="h-5 w-5 rounded-full bg-secondary/50 animate-pulse shrink-0" />
          <div className="h-3.5 w-24 bg-secondary/40 animate-pulse rounded-sm" />
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-2 rounded-sm"
            >
              <div className="h-4 w-4 bg-secondary/30 animate-pulse rounded-sm shrink-0" />
              <div className="h-3.5 w-20 bg-secondary/30 animate-pulse rounded-sm" />
            </div>
          ))}
        </nav>

        {/* Theme toggle */}
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="h-4 w-4 bg-secondary/30 animate-pulse rounded-sm shrink-0" />
            <div className="h-3 w-16 bg-secondary/30 animate-pulse rounded-sm" />
          </div>
        </div>

        {/* User area */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-secondary/40 animate-pulse shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-20 bg-secondary/30 animate-pulse rounded-sm" />
              <div className="h-2 w-14 bg-secondary/20 animate-pulse rounded-sm" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header skeleton — matches real AppLayout (visible on mobile, hidden on md+) */}
        <header className="h-14 border-b border-border flex items-center px-4 md:px-6 bg-card md:hidden">
          <div className="h-5 w-5 bg-secondary/30 animate-pulse rounded-sm mr-3" />
          <div className="h-4 w-24 bg-secondary/30 animate-pulse rounded-sm" />
        </header>

        <main className="flex-1 p-4 sm:p-6 md:p-8 lg:p-10 overflow-y-auto">
          <ContentSkeleton />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard skeleton — welcome text + due-date card
// ---------------------------------------------------------------------------

export function DashboardSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-6 w-40 bg-secondary/50 animate-pulse rounded-sm" />
        <div className="h-4 w-56 bg-secondary/30 animate-pulse rounded-sm" />
      </div>

      {/* Due date card */}
      <Card className="border-border shadow-none">
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-secondary/40 animate-pulse shrink-0" />
            <div className="space-y-2">
              <div className="h-5 w-28 bg-secondary/50 animate-pulse rounded-sm" />
              <div className="h-3.5 w-36 bg-secondary/30 animate-pulse rounded-sm" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoices skeleton — highlighted card + regular cards
// Extracted from Invoices.tsx internal InvoicesSkeleton component.
// ---------------------------------------------------------------------------

export function InvoicesSkeleton() {
  return (
    <div className="space-y-6">
      {/* Skeleton header */}
      <div className="space-y-2">
        <div className="h-6 w-24 bg-secondary/60 rounded-sm animate-pulse" />
        <div className="h-4 w-72 bg-secondary/40 rounded-sm animate-pulse" />
      </div>

      {/* Skeleton highlighted card */}
      <Card className="border-border shadow-sm">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <div className="h-10 w-10 rounded-full bg-secondary/50 animate-pulse shrink-0" />
              <div className="space-y-3 min-w-0">
                <div className="h-4 w-32 bg-secondary/50 rounded-full animate-pulse" />
                <div className="h-5 w-40 bg-secondary/60 rounded-sm animate-pulse" />
                <div className="h-3 w-28 bg-secondary/40 rounded-sm animate-pulse" />
              </div>
            </div>
            <div className="text-right space-y-2 shrink-0">
              <div className="h-6 w-24 bg-secondary/60 rounded-sm animate-pulse ml-auto" />
              <div className="h-4 w-16 bg-secondary/40 rounded-sm animate-pulse ml-auto" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-border flex gap-2">
            <div className="h-7 w-28 bg-secondary/40 rounded-sm animate-pulse" />
            <div className="h-7 w-16 bg-secondary/40 rounded-sm animate-pulse" />
            <div className="h-7 w-14 bg-secondary/40 rounded-sm animate-pulse" />
          </div>
        </CardContent>
      </Card>

      {/* Skeleton section divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border/20" />
        <div className="h-3 w-28 bg-secondary/40 rounded-sm animate-pulse" />
        <div className="h-px flex-1 bg-border/20" />
      </div>

      {/* Skeleton regular cards */}
      {[1, 2].map((i) => (
        <Card key={i} className="border-border shadow-none">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-full bg-secondary/40 animate-pulse shrink-0" />
                <div className="space-y-2">
                  <div className="h-3 w-20 bg-secondary/40 rounded-full animate-pulse" />
                  <div className="h-3 w-36 bg-secondary/30 rounded-sm animate-pulse" />
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="h-4 w-20 bg-secondary/50 rounded-sm animate-pulse" />
                <div className="h-5 w-14 bg-secondary/40 rounded-sm animate-pulse" />
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-border/50 flex gap-1">
              <div className="h-6 w-24 bg-secondary/30 rounded-sm animate-pulse" />
              <div className="h-6 w-12 bg-secondary/30 rounded-sm animate-pulse" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invoice Detail skeleton — back button + two info cards side by side
// ---------------------------------------------------------------------------

export function InvoiceDetailSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <div className="h-3.5 w-32 bg-secondary/30 animate-pulse rounded-sm" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-6 w-36 bg-secondary/50 animate-pulse rounded-sm" />
          <div className="h-4 w-20 bg-secondary/30 animate-pulse rounded-full" />
        </div>
        <div className="h-7 w-28 bg-secondary/50 animate-pulse rounded-sm" />
      </div>

      {/* Two-column info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              <div className="h-4 w-24 bg-secondary/40 animate-pulse rounded-sm" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <div className="flex items-center justify-between">
                  <div className="h-3 w-20 bg-secondary/30 animate-pulse rounded-sm" />
                  <div className="h-3 w-28 bg-secondary/30 animate-pulse rounded-sm" />
                </div>
                {i < 3 && <div className="h-px bg-border mt-3" />}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              <div className="h-4 w-16 bg-secondary/40 animate-pulse rounded-sm" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i}>
                <div className="h-3 w-24 bg-secondary/30 animate-pulse rounded-sm" />
                <div className="mt-2 h-8 w-full bg-secondary/20 animate-pulse rounded-sm" />
              </div>
            ))}
            <div className="h-9 w-full bg-secondary/30 animate-pulse rounded-md mt-3" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile skeleton — two-column layout matching Profile page structure
// Extracted from Profile.tsx inline loading state.
// ---------------------------------------------------------------------------

export function ProfileSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Skeleton header */}
      <div className="space-y-2">
        <div className="h-6 w-16 bg-secondary/60 rounded-sm animate-pulse" />
        <div className="h-4 w-44 bg-secondary/40 rounded-sm animate-pulse" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Main card skeleton */}
        <div className="md:col-span-2">
          <Card className="border-border shadow-none">
            <CardContent className="p-5 space-y-4">
              {/* Avatar + name row */}
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-full bg-secondary/50 animate-pulse shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-5 w-40 bg-secondary/60 rounded-sm animate-pulse" />
                  <div className="h-3 w-24 bg-secondary/40 rounded-sm animate-pulse" />
                </div>
                <div className="h-5 w-16 bg-secondary/40 rounded-full animate-pulse shrink-0" />
              </div>
              <div className="h-px bg-border" />

              {/* Info rows */}
              {[1, 2, 3, 4].map((i) => (
                <div key={i}>
                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-3.5 w-3.5 bg-secondary/40 rounded-sm animate-pulse shrink-0" />
                      <div className="h-3 w-16 bg-secondary/40 rounded-sm animate-pulse" />
                    </div>
                    <div className="h-3 w-32 bg-secondary/40 rounded-sm animate-pulse" />
                  </div>
                  <div className="h-px bg-border mt-3" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar skeleton */}
        <div className="space-y-4">
          <Card className="border-border shadow-none">
            <CardContent className="p-5 space-y-3">
              <div className="h-4 w-20 bg-secondary/60 rounded-sm animate-pulse" />
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-secondary/40 animate-pulse shrink-0" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-3 w-16 bg-secondary/40 rounded-sm animate-pulse" />
                    <div className="h-2.5 w-28 bg-secondary/30 rounded-sm animate-pulse" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="border-border shadow-none">
            <CardContent className="p-5">
              <div className="h-4 w-14 bg-secondary/60 rounded-sm animate-pulse mb-3" />
              <div className="h-9 w-full bg-secondary/40 rounded-md animate-pulse" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
