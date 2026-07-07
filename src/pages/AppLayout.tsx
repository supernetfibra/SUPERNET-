/**
 * App Layout — Sidebar navigation wrapper for authenticated pages.
 * Minimalist design with clean sidebar and header.
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
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  FileText,
  User,
  LogOut,
  Wifi,
  Menu,
  X,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth-context";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Faturas", href: "/faturas", icon: FileText },
  { name: "Perfil", href: "/perfil", icon: User },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { customer, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{
          x: sidebarOpen ? 0 : -280,
        }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-card md:relative md:translate-x-0 md:block"
        style={{ x: sidebarOpen ? 0 : undefined }}
      >
        {/* Only use motion for mobile; on desktop always show */}
        <div className="flex flex-col h-full md:block">
          {/* Logo */}
          <div className="h-14 flex items-center gap-2 px-5 border-b border-border">
            <Wifi className="h-5 w-5 text-foreground shrink-0" />
            <span className="text-sm font-medium tracking-tight">MikWeb</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="ml-auto md:hidden text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href;
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
                  <span>{item.name}</span>
                  {isActive && (
                    <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* User & Logout */}
          <div className="border-t border-border p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-sm text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all">
                  <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-foreground">
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
              <DropdownMenuContent align="end" className="w-56">
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
      </motion.aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header className="h-14 border-b border-border flex items-center px-4 md:px-6 bg-card md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-muted-foreground hover:text-foreground transition-colors mr-3"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-foreground" />
            <span className="text-sm font-medium">MikWeb</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 md:p-8 lg:p-10 overflow-y-auto">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
