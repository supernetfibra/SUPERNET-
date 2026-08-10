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
// A senha é validada no servidor (MIKWEB_ADMIN_PASSWORD), nunca no cliente.
// ---------------------------------------------------------------------------
const ADMIN_CPF = "00000000000";
const ADMIN_TOKEN_KEY = "mikweb_admin_token";

function isAdminCpf(cpf: string): boolean {
  return cpf.replace(/\D/g, "") === ADMIN_CPF;
}

function storeAdminSession(token?: string, expiresAt?: number) {
  const sessionToken = token || generateSessionToken();
  const exp = expiresAt || Date.now() + 8 * 60 * 60 * 1000;
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, sessionToken);
    localStorage.setItem(ADMIN_TOKEN_KEY + "_expires", String(exp));
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
      console.log("[AUTH] Sessão admin válida encontrada no localStorage");
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

  // Login with CPF + password (first 4 digits of CPF, or admin password for admin CPF)
  const login = useCallback(
    async (cpf: string, password: string, keepConnected?: boolean): Promise<LoginResponse> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      const normalizedCpf = cpf.replace(/\D/g, "");

      // ---- ADMIN - cria sessão real no servidor (CPF 000.000.000-00 + senha dedicada) ----
      if (isAdminCpf(normalizedCpf)) {
        console.log("[AUTH] Admin CPF detectado, validando senha no servidor...");
        try {
          const response = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ password }),
          });

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            const errMsg = data.error || "Senha de administrador incorreta.";
            console.warn("[AUTH] Admin senha incorreta");
            setState((prev) => ({ ...prev, isLoading: false, error: errMsg }));
            throw new Error(errMsg);
          }

          console.log("[AUTH] Admin sessão criada no servidor");
          const serverToken = data.sessionToken || "";
          const serverExpires = data.expiresAt || Date.now() + 8 * 60 * 60 * 1000;
          storeAdminSession(serverToken, serverExpires);

          const adminData: LoginResponse = {
            success: true,
            customer: { id: "admin-00000000000", name: "Administrador", email: "admin@provedor.com" },
            hasMultipleContacts: false,
            contacts: [],
            sessionToken: serverToken,
            expiresAt: serverExpires,
          };
          setState({
            isLoading: false,
            isAuthenticated: true,
            customer: { id: "admin-00000000000", name: "Administrador", cpf: normalizedCpf },
            error: null,
          });
          console.log("[AUTH] Admin login concluído, redirecionando...");
          return adminData;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Erro ao conectar com o servidor.";
          setState((prev) => ({ ...prev, isLoading: false, error: message }));
          throw err;
        }
      }
      // ---- END ADMIN ----

      // ---- TEST USER - handle locally ----
      if (isTestCpf(normalizedCpf)) {
        if (!validateTestPassword(normalizedCpf, password)) {
          const errMsg = "Senha incorreta. Use os 4 primeiros dígitos do seu CPF como senha inicial.";
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
