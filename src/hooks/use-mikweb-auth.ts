/**
 * Custom authentication hook for MikWeb Customer Portal.
 *
 * Manages auth state via the httpOnly session cookie set by the Convex HTTP endpoint.
 * Provides login, logout, and session check functions.
 */

import { useCallback, useEffect, useState } from "react";
import {
  isTestCpf,
  validateTestPassword,
  getTestLoginResponse,
  storeTestSession,
  clearTestSession,
  getStoredTestSession,
} from "@/lib/test-user";
import { generateSessionToken } from "@/lib/session-token";

// ---------------------------------------------------------------------------
// Admin credentials — CPF específico + senha dedicada para acesso admin
// O CPF 000.000.000-00 nunca pertence a um cliente real (invalido para PF)
// ---------------------------------------------------------------------------
const ADMIN_CPF = "00000000000";
const ADMIN_PASSWORD = "slackware@";
const ADMIN_TOKEN_KEY = "mikweb_admin_token";

function isAdminCpf(cpf: string): boolean {
  return cpf.replace(/\D/g, "") === ADMIN_CPF;
}

function storeAdminSession() {
  const token = generateSessionToken();
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    localStorage.setItem(ADMIN_TOKEN_KEY + "_expires", String(Date.now() + 8 * 60 * 60 * 1000));
  } catch {}
}

function clearAdminSession() {
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_KEY + "_expires");
  } catch {}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  customer: { id: string; name: string; cpf: string } | null;
  error: string | null;
}

export interface LoginResponse {
  success: boolean;
  customer: { id: string; name: string; email?: string };
  hasMultipleContacts: boolean;
  contacts: Array<{ id: string; label: string; phoneMasked: string }>;
  sessionToken?: string;
  expiresAt?: number;
}

export interface MeResponse {
  authenticated: boolean;
  customer?: { id: string; name: string; cpf: string };
  error?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMikWebAuth() {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    customer: null,
    error: null,
  });

  // Check session on mount
  const checkSession = useCallback(async () => {
    // ---- ADMIN - check localStorage ----
    const adminToken = localStorage.getItem(ADMIN_TOKEN_KEY);
    const adminExpires = localStorage.getItem(ADMIN_TOKEN_KEY + "_expires");
    if (adminToken && adminExpires && Date.now() < Number(adminExpires)) {
      setState({
        isLoading: false,
        isAuthenticated: true,
        customer: { id: "admin-00000000000", name: "Administrador", cpf: "00000000000" },
        error: null,
      });
      return;
    }
    // ---- END ADMIN ----

    // ---- TEST USER - check localStorage ----
    const testSession = getStoredTestSession();
    if (testSession) {
      setState({
        isLoading: false,
        isAuthenticated: true,
        customer: { id: testSession.customerId, name: testSession.customerName, cpf: testSession.cpf },
        error: null,
      });
      return;
    }
    // ---- END TEST USER ----

    try {
      const response = await fetch("/api/mikweb/me", {
        method: "GET",
        credentials: "include",
      });

      if (response.ok) {
        const data: MeResponse = await response.json();
        if (data.authenticated && data.customer) {
          setState({
            isLoading: false,
            isAuthenticated: true,
            customer: data.customer,
            error: null,
          });
          return;
        }
      }

      setState({
        isLoading: false,
        isAuthenticated: false,
        customer: null,
        error: null,
      });
    } catch {
      setState({
        isLoading: false,
        isAuthenticated: false,
        customer: null,
        error: null,
      });
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Login with CPF + password (last 4 digits of CPF, or admin password for admin CPF)
  const login = useCallback(
    async (cpf: string, password: string, keepConnected?: boolean): Promise<LoginResponse> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const normalizedCpf = cpf.replace(/\D/g, "");

      // ---- ADMIN - handle locally (CPF 000.000.000-00 + senha dedicada) ----
      if (isAdminCpf(normalizedCpf)) {
        if (password !== ADMIN_PASSWORD) {
          const errMsg = "Senha de administrador incorreta.";
          setState((prev) => ({ ...prev, isLoading: false, error: errMsg }));
          throw new Error(errMsg);
        }

        storeAdminSession();
        const adminData: LoginResponse = {
          success: true,
          customer: { id: "admin-00000000000", name: "Administrador", email: "admin@provedor.com" },
          hasMultipleContacts: false,
          contacts: [],
          sessionToken: "",
          expiresAt: Date.now() + 8 * 60 * 60 * 1000,
        };
        setState({
          isLoading: false,
          isAuthenticated: true,
          customer: { id: "admin-00000000000", name: "Administrador", cpf: normalizedCpf },
          error: null,
        });
        return adminData;
      }
      // ---- END ADMIN ----

      // ---- TEST USER - handle locally ----
      if (isTestCpf(normalizedCpf)) {
        if (!validateTestPassword(normalizedCpf, password)) {
          const errMsg = "Senha incorreta. Use os 4 últimos dígitos do seu CPF como senha inicial.";
          setState((prev) => ({ ...prev, isLoading: false, error: errMsg }));
          throw new Error(errMsg);
        }

        storeTestSession();
        const testData = getTestLoginResponse();
        setState({
          isLoading: false,
          isAuthenticated: true,
          customer: { id: testData.customer.id, name: testData.customer.name, cpf: normalizedCpf },
          error: null,
        });
        return testData;
      }
      // ---- END TEST USER ----

      try {
        const response = await fetch("/api/mikweb/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ cpf, password, keepConnected }),
        });

        const data = await response.json();

        if (!response.ok) {
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: data.error || "Erro ao fazer login.",
          }));
          throw new Error(data.error || "Erro ao fazer login.");
        }

        // Authentication complete — always go straight to dashboard
        setState({
          isLoading: false,
          isAuthenticated: true,
          customer: {
            id: data.customer.id,
            name: data.customer.name,
            cpf,
          },
          error: null,
        });

        return data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Erro ao conectar com o servidor.";
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: message,
        }));
        throw err;
      }
    },
    []
  );

  // Logout
  const logout = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));

    // Clear any admin or test session
    clearAdminSession();
    clearTestSession();

    try {
      await fetch("/api/mikweb/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore logout errors — clear state anyway
    }

    setState({
      isLoading: false,
      isAuthenticated: false,
      customer: null,
      error: null,
    });
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    login,
    logout,
    clearError,
    checkSession,
  };
}
