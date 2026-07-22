/**
 * App Layout — Desktop sidebar + mobile bottom navbar.
 * Sidebar (w-64) visible on md+; bottom nav bar on mobile with 3 tabs.
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
  ChevronRight,
  Sun,
  Moon,
  CircleUser,
} from "lucide-react";
import { useMemo } from "react";
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

  const handleLogout = async () => {
    clearCache();
    await logout();
    navigate("/login");
  };

  // ── Billing badges ──
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

  const isActive = (href: string) => location.pathname === href;

  return (
    <div className="min-h-screen flex bg-background">
      {/* ── Desktop sidebar (hidden on mobile) ── */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card shrink-0 h-screen sticky top-0">
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
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const active = isActive(item.href);
            const isFaturas = item.href === "/faturas";
            const badge = isFaturas ? billingCounts : null;
            const hasUrgent = badge && badge.overdue > 0;
            const hasWarning = badge && !hasUrgent && badge.expiringSoon > 0;

            return (
              <button
                key={item.name}
                onClick={() => navigate(item.href)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-sm text-sm transition-all ${
                  active
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
                {active && (
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
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile only) */}
        <header className="h-14 border-b border-border flex items-center px-4 bg-card md:hidden sticky top-0 z-30">
          <div className="flex items-center gap-2 flex-1">
            {logoUrl ? (
              <img src={logoUrl} alt={providerName} className="h-4 w-4 rounded-full object-cover" />
            ) : (
              <Wifi className="h-4 w-4 text-foreground" />
            )}
            <span className="text-sm font-medium truncate">{providerName}</span>
          </div>
          {/* User avatar on mobile top bar */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-foreground hover:bg-secondary/70 transition-colors shrink-0"
                aria-label={customer?.name || "Usuário"}
              >
                {customer?.name?.charAt(0)?.toUpperCase() || <CircleUser className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-56 mr-2">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {customer?.name}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/perfil")} className="text-sm">
                <User className="mr-2 h-4 w-4" />
                Meu Perfil
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  toggleTheme();
                }}
                className="text-sm"
              >
                {theme === "dark" ? (
                  <Sun className="mr-2 h-4 w-4" />
                ) : (
                  <Moon className="mr-2 h-4 w-4" />
                )}
                {theme === "dark" ? "Modo claro" : "Modo escuro"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-sm text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content — extra pb on mobile for bottom nav */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 lg:p-10 overflow-y-auto pb-20 md:pb-10">
          <div key={location.pathname} className="animate-[fadeIn_0.25s_ease-out]">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ── Mobile bottom navbar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-md" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {navigation.map((item) => {
            const active = isActive(item.href);
            const isFaturas = item.href === "/faturas";
            const badge = isFaturas ? billingCounts : null;

            return (
              <button
                key={item.name}
                onClick={() => navigate(item.href)}
                className={`relative flex flex-col items-center justify-center gap-0.5 py-1 px-4 h-full min-w-[64px] transition-all ${
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {/* Active indicator */}
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-foreground rounded-full" />
                )}
                <div className="relative">
                  <item.icon className="h-5 w-5" />
                  {/* Badge on Faturas icon */}
                  {isFaturas && badge && badge.total > 0 && (
                    <span className={`absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[16px] h-[16px] rounded-full text-[9px] font-bold leading-none px-1 ${
                      badge.overdue > 0
                        ? "bg-red-500 text-white"
                        : "bg-amber-500 text-white"
                    }`}>
                      {badge.total}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium leading-none">
                  {item.name}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
