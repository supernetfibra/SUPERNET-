/**
 * App Layout — Sidebar navigation wrapper for authenticated pages.
 * Fixed-width sidebar (w-64) with navigation, theme toggle, user menu.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  FileText,
  User,
  LogOut,
  Wifi,
  Menu,
  X,
  ChevronRight,
  Sun,
  Moon,
} from "lucide-react";
import { useState, useMemo } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { useBranding } from "@/lib/branding-context";
import { useTheme } from "@/lib/theme-provider";
import { useBillings, diasAteVencimento, clearCache } from "@/hooks/use-billings";
import type { BillingSummary } from "@/hooks/use-billings";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Faturas", href: "/faturas", icon: FileText },
  { name: "Perfil", href: "/perfil", icon: User },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { customer, logout } = useAuth();
  const { providerName, logoUrl } = useBranding();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    clearCache();
    await logout();
    navigate("/login");
  };

  // ── Billing badges for sidebar ──
  const { billings } = useBillings();

  const billingCounts = useMemo(() => {
    const overdue = billings.filter((b: BillingSummary) => b.status === "vencido").length;
    const pending = billings.filter((b: BillingSummary) => b.status === "pendente").length;
    const total = overdue + pending;

    const expiringSoon = billings.filter((b: BillingSummary) => {
      if (b.status === "pago" || b.status === "cancelado") return false;
      const dias = diasAteVencimento(b.vencimento);
      return dias !== null && dias <= 3;
    }).length;

    return { overdue, pending, total, expiringSoon };
  }, [billings]);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden animate-[fadeIn_0.2s_ease-out]"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card transition-transform duration-200 ease-in-out md:relative md:translate-x-0 md:block ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo / Brand */}
          <div className="h-14 flex items-center gap-2 px-5 border-b border-border shrink-0">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={providerName}
                className="h-5 w-5 rounded-full object-cover shrink-0"
              />
            ) : (
              <Wifi className="h-5 w-5 text-foreground shrink-0" />
            )}
            <span className="text-sm font-medium tracking-tight truncate flex-1">
              {providerName}
            </span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="md:hidden text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
              const isFaturas = item.href === "/faturas";
              const badge = isFaturas ? billingCounts : null;
              const hasUrgent = badge && badge.overdue > 0;
              const hasWarning = badge && !hasUrgent && badge.expiringSoon > 0;

              return (
                <button
                  key={item.name}
                  onClick={() => {
                    navigate(item.href);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-all ${
                    isActive
                      ? "bg-secondary text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate flex-1 text-left">{item.name}</span>
                  {/* Badge count */}
                  {isFaturas && badge && badge.total > 0 && (
                    <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold leading-none px-1 ${
                      hasUrgent
                        ? "bg-red-500/15 text-red-600 dark:text-red-400 dark:bg-red-500/20"
                        : hasWarning
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 dark:bg-amber-500/20"
                        : "bg-secondary text-muted-foreground"
                    }`}>
                      {badge.total}
                    </span>
                  )}
                  {isActive && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Theme toggle */}
          <div className="border-t border-border px-3 py-2">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-sm text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all"
              aria-label={theme === "dark" ? "Modo claro" : "Modo escuro"}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 shrink-0" />
              ) : (
                <Moon className="h-4 w-4 shrink-0" />
              )}
              <span className="text-xs truncate">
                {theme === "dark" ? "Modo claro" : "Modo escuro"}
              </span>
            </button>
          </div>

          {/* User & Logout */}
          <div className="border-t border-border p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-sm text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all"
                  aria-label={customer?.name || "Usuário"}
                >
                  <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-foreground shrink-0">
                    {customer?.name?.charAt(0)?.toUpperCase() || "U"}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-xs font-medium text-foreground truncate">
                      {customer?.name || "Usuário"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {customer?.cpf ? `CPF: ***${customer.cpf.slice(-3)}` : ""}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" sideOffset={4} className="w-56">
                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                  {customer?.name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/perfil")} className="text-sm">
                  <User className="mr-2 h-4 w-4" />
                  Meu Perfil
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-sm text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header className="h-14 border-b border-border flex items-center px-4 md:px-6 bg-card md:hidden sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-muted-foreground hover:text-foreground transition-colors mr-3"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt={providerName} className="h-4 w-4 rounded-full object-cover" />
            ) : (
              <Wifi className="h-4 w-4 text-foreground" />
            )}
            <span className="text-sm font-medium">{providerName}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 lg:p-10 overflow-y-auto">
          <div key={location.pathname} className="animate-[fadeIn_0.25s_ease-out]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
