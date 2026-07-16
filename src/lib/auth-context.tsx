/**
 * Auth Context Provider for MikWeb Customer Portal.
 * Provides auth state across all authenticated pages.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useMikWebAuth, type AuthState } from "@/hooks/use-mikweb-auth";

interface AuthContextValue extends AuthState {
  login: (cpf: string, password: string, keepConnected?: boolean) => Promise<any>;
  logout: () => Promise<void>;
  selectContact: (contactId: string) => Promise<void>;
  clearError: () => void;
  checkSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useMikWebAuth();

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
