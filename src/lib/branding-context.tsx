/**
 * Branding Context — Provides the provider name and logo URL
 * to all pages in the app. Loaded once from the backend on mount.
 */

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface BrandingConfig {
  providerName: string;
  logoUrl: string;
}

const BrandingContext = createContext<BrandingConfig>({
  providerName: "Seu Provedor",
  logoUrl: "",
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>({
    providerName: "Seu Provedor",
    logoUrl: "",
  });

  useEffect(() => {
    fetch("/api/admin/branding", { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setBranding({
            providerName: data.providerName || "MikWeb",
            logoUrl: data.logoUrl || "",
          });
        }
      })
      .catch(() => {
        // Fallback to default
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
