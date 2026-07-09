/**
 * Branding Context — Provides the provider name and logo URL
 * to all pages in the app. Loaded from localStorage first (instant),
 * then attempts to sync from the server.
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface BrandingConfig {
  providerName: string;
  logoUrl: string;
}

const BRANDING_STORAGE_KEY = "mikweb_branding";

function loadFromStorage(): BrandingConfig | null {
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const defaults: BrandingConfig = { providerName: "Seu Provedor", logoUrl: "" };

const BrandingContext = createContext<BrandingConfig>(defaults);

export function BrandingProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage for instant availability
  const stored = loadFromStorage();
  const [branding, setBranding] = useState<BrandingConfig>(stored || defaults);

  useEffect(() => {
    // Try to sync from server in the background
    fetch("/api/admin/branding", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.providerName) {
          const fresh = {
            providerName: data.providerName,
            logoUrl: data.logoUrl || "",
          };
          setBranding(fresh);
          // Sync to localStorage
          try {
            localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(fresh));
          } catch {}
        }
      })
      .catch(() => {
        // Server unavailable — localStorage fallback already in place
      });
  }, []);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
