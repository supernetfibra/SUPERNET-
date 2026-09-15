/**
 * Admin Layout — Desktop sidebar + mobile bottom navbar for admin pages.
 * Mirrors the client AppLayout pattern for consistency.
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
  Home,
  LogOut,
  Wifi,
  ChevronRight,
  Sun,
  Moon,
  CircleUser,
  Activity,
  Settings,
  Bell,
  Search,
} from "lucide-react";
import { Outlet, useNavigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth-context";
import { useBranding } from "@/lib/branding-context";
import { useTheme } from "@/lib/theme-provider";

const adminNavigation = [
  { name: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { name: "Solicitações", href: "/admin/install-requests", icon: Home },
  { name: "Configurações", href: "/admin/settings", icon: Settings },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { customer, logout } = useAuth();
  const { providerName, logoUrl } = useBranding();
  const { theme, toggleTheme } = useTheme();

  const handleLogout = async () => {
    await logout();
    navigate("/admin");
  };

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
          <span className="text-[9px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-sm">
            Admin
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {adminNavigation.map((item) => {
            const active = isActive(item.href);
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
                aria-label={customer?.name || "Admin"}
              >
                <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-foreground shrink-0">
                  {customer?.name?.charAt(0)?.toUpperCase() || "A"}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-medium text-foreground truncate">
                    {customer?.name || "Administrador"}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    Conta administrativa
                  </p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" sideOffset={4} className="w-56">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {customer?.name || "Administrador"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-sm text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Sair do painel
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
            <span className="text-[9px] font-medium text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-sm">
              Admin
            </span>
          </div>
          {/* User avatar on mobile top bar */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-foreground hover:bg-secondary/70 transition-colors shrink-0"
                aria-label={customer?.name || "Admin"}
              >
                {customer?.name?.charAt(0)?.toUpperCase() || <CircleUser className="h-4 w-4" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-56 mr-2">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {customer?.name || "Administrador"}
              </DropdownMenuLabel>
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
          {adminNavigation.map((item) => {
            const active = isActive(item.href);
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
