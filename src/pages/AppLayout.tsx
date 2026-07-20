/**
 * App Layout — Sidebar navigation wrapper for authenticated pages.
 * Minimalist design with clean sidebar and header.
 * Collapsible on desktop (icon-only mode) to free content area.
 * Uses CSS transitions instead of framer-motion.
 */

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  FileText,
  User,
  LogOut,
  Wifi,
  Menu,
  X,
  ChevronRight,
  ChevronLeft,
  PanelLeftClose,
  PanelLeft,
  Sun,
  Moon,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { useBranding } from "@/lib/branding-context";
import { useTheme } from "@/lib/theme-provider";
import { useBillings, diasAteVencimento, clearCache } from "@/hooks/use-billings";
import type { BillingSummary } from "@/hooks/use-billings";

const COLLAPSED_KEY = "mikweb_sidebar_collapsed";

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

  // Desktop collapsed state — persisted in localStorage
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  // Persist preference
  useEffect(() => {
    try {
      if (collapsed) {
        localStorage.setItem(COLLAPSED_KEY, "true");
      } else {
        localStorage.removeItem(COLLAPSED_KEY);
      }
    } catch {}
  }, [collapsed]);

  // Keyboard shortcut: Ctrl+B / Cmd+B to toggle (desktop only, not in inputs)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        if (window.innerWidth >= 768) {
          setCollapsed((prev) => !prev);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleLogout = async () => {
    clearCache();
    await logout();
    navigate("/login");
  };

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  // ── Billing badges for sidebar ──
  const { billings } = useBillings();

  const billingCounts = useMemo(() => {
    const overdue = billings.filter((b: BillingSummary) => b.status === "vencido").length;
    const pending = billings.filter((b: BillingSummary) => b.status === "pendente").length;
    const total = overdue + pending;

    // Count invoices expiring within 3 days (including overdue)
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
        className={`fixed inset-y-0 left-0 z-50 border-r border-border bg-card transition-all duration-200 ease-in-out md:relative md:translate-x-0 md:block ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <div className={`flex flex-col h-full ${collapsed ? "items-center" : ""}`}>
          {/* Logo / Brand */}
          <div className={`h-14 flex items-center border-b border-border shrink-0 ${
            collapsed ? "justify-center px-0 w-full" : "gap-2 px-5"
          }`}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={providerName}
                className="h-5 w-5 rounded-full object-cover shrink-0"
              />
            ) : (
              <Wifi className="h-5 w-5 text-foreground shrink-0" />
            )}
            {!collapsed && (
              <span className="text-sm font-medium tracking-tight truncate">
                {providerName}
              </span>
            )}
            {/* Close button (mobile only) */}
            <button
              onClick={() => setSidebarOpen(false)}
              className={`md:hidden text-muted-foreground hover:text-foreground transition-colors ${
                collapsed ? "hidden" : "ml-auto"
              }`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Navigation */}
          <nav className={`flex-1 py-4 overflow-y-auto ${
            collapsed ? "px-2 space-y-2" : "px-3 space-y-1"
          }`}>
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
              const isFaturas = item.href === "/faturas";
              const badge = isFaturas ? billingCounts : null;
              const hasUrgent = badge && badge.overdue > 0;
              const hasWarning = badge && !hasUrgent && badge.expiringSoon > 0;

              const button = (
                <button
                  key={item.name}
                  onClick={() => {
                    navigate(item.href);
                    setSidebarOpen(false);
                  }}
                  className={`w-full flex items-center rounded-sm transition-all ${
                    collapsed
                      ? "justify-center h-10 px-0"
                      : "gap-3 px-3 py-2"
                  } ${
                    isActive
                      ? "bg-secondary text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  <div className="relative shrink-0">
                    <item.icon className={`${
                      collapsed ? "h-5 w-5" : "h-4 w-4"
                    }`} />
                    {/* Badge dot for collapsed mode */}
                    {collapsed && badge && badge.total > 0 && (
                      <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-card ${
                        hasUrgent
                          ? "bg-red-500"
                          : hasWarning
                          ? "bg-amber-500"
                          : "bg-muted-foreground"
                      }`} />
                    )}
                  </div>
                  {!collapsed && (
                    <>
                      <span className="text-sm truncate flex-1">{item.name}</span>
                      {/* Badge count for expanded mode */}
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
                        <ChevronRight className="h-3 w-3 ml-1 text-muted-foreground shrink-0" />
                      )}
                    </>
                  )}
                </button>
              );

              // Wrap in tooltip when collapsed
              if (collapsed) {
                const tooltipLabel = isFaturas && badge && badge.total > 0
                  ? `${item.name} (${badge.total} pendente${badge.total !== 1 ? "s" : ""})`
                  : item.name;
                return (
                  <Tooltip key={item.name}>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      <p>{tooltipLabel}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return button;
            })}
          </nav>

          {/* Collapse toggle (desktop only) */}
          <div className={`border-t border-border ${
            collapsed ? "px-2 py-2" : "px-3 py-2"
          }`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapsed}
                  className={`w-full flex items-center rounded-sm transition-all text-muted-foreground hover:text-foreground hover:bg-secondary/50 ${
                    collapsed
                      ? "justify-center h-10 px-0"
                      : "gap-3 px-3 py-2"
                  }`}
                  aria-label={collapsed ? "Expandir sidebar" : "Recolher sidebar"}
                  aria-expanded={!collapsed}
                >
                  {collapsed ? (
                    <PanelLeft className="shrink-0 h-5 w-5" />
                  ) : (
                    <PanelLeftClose className="shrink-0 h-4 w-4" />
                  )}
                  {!collapsed && (
                    <span className="text-xs truncate">Recolher</span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p>{collapsed ? "Expandir (Ctrl+B)" : "Recolher (Ctrl+B)"}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Theme toggle */}
          <div className={`border-t border-border ${
            collapsed ? "px-2 py-2" : "px-3 py-2"
          }`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  className={`w-full flex items-center rounded-sm transition-all text-muted-foreground hover:text-foreground hover:bg-secondary/50 ${
                    collapsed
                      ? "justify-center h-10 px-0"
                      : "gap-3 px-3 py-2"
                  }`}
                  aria-label={theme === "dark" ? "Modo claro" : "Modo escuro"}
                >
                  {theme === "dark" ? (
                    <Sun className={`shrink-0 ${
                      collapsed ? "h-5 w-5" : "h-4 w-4"
                    }`} />
                  ) : (
                    <Moon className={`shrink-0 ${
                      collapsed ? "h-5 w-5" : "h-4 w-4"
                    }`} />
                  )}
                  {!collapsed && (
                    <span className="text-xs truncate">
                      {theme === "dark" ? "Modo claro" : "Modo escuro"}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p>{theme === "dark" ? "Modo claro" : "Modo escuro"}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* User & Logout */}
          <div className={`border-t border-border ${
            collapsed ? "px-2 py-2" : "p-3"
          }`}>
            <div className={collapsed ? "w-full flex justify-center" : ""}>
            <DropdownMenu>
              <Tooltip>
              <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className={`w-full flex items-center rounded-sm transition-all text-muted-foreground hover:text-foreground hover:bg-secondary/50 ${
                    collapsed
                      ? "justify-center h-10 px-0"
                      : "gap-3 px-3 py-2"
                  }`}
                  aria-label={customer?.name || "Usuário"}
                >
                  <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-foreground shrink-0">
                    {customer?.name?.charAt(0)?.toUpperCase() || "U"}
                  </div>
                  {!collapsed && (
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-xs font-medium text-foreground truncate">
                        {customer?.name || "Usuário"}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {customer?.cpf ? `CPF: ***${customer.cpf.slice(-3)}` : ""}
                      </p>
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right" sideOffset={8}>
                  <p>{customer?.name || "Usuário"}</p>
                </TooltipContent>
              )}
              </Tooltip>
              <DropdownMenuContent
                align={collapsed ? "start" : "end"}
                side={collapsed ? "right" : "top"}
                sideOffset={4}
                className="w-56"
              >
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
