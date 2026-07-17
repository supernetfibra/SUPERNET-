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

const API_BASE = import.meta.env.VITE_CONVEX_URL;

export function useMikWebAuth() {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    customer: null,
    error: null,
  });

  // Check session on mount
  const checkSession = useCallback(async () => {
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

  // Login with CPF + password (last 4 digits of CPF)
  const login = useCallback(
    async (cpf: string, password: string, keepConnected?: boolean): Promise<LoginResponse> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      // ---- TEST USER - handle locally ----
      const normalizedCpf = cpf.replace(/\D/g, "");
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

        if (!data.hasMultipleContacts || !data.contacts?.length) {
          // Single contact or no contacts needed — authentication complete
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
        } else {
          // Multiple contacts — need to select one
          setState((prev) => ({
            ...prev,
            isLoading: false,
          }));
        }

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

  // Select contact after multiple contacts found
  const selectContact = useCallback(
    async (contactId: string): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true }));

      try {
        const response = await fetch("/api/mikweb/select-contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ contactId }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Erro ao selecionar contato.");
        }

        // Re-check session to get updated customer data
        await checkSession();
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error:
            err instanceof Error
              ? err.message
              : "Erro ao selecionar contato.",
        }));
        throw err; // Re-throw so callers (e.g. ContactSelect) can prevent navigation on error
      }
    },
    [checkSession]
  );

  // Logout
  const logout = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));

    // Clear any test session
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
    selectContact,
    clearError,
    checkSession,
  };
}
