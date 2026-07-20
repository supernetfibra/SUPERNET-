/**
 * Branding Context — Provides the provider name, logo URL,
 * and accent color (extracted from the logo) to all pages.
 * When the accent color changes, it's applied as the --primary CSS variable
 * so all primary buttons and accents use the logo's dominant color.
 *
 * Loaded from localStorage first (instant),
 * then attempts to sync from the server.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { extractDominantColor } from "./extract-dominant-color";

interface BrandingConfig {
  providerName: string;
  logoUrl: string;
  accentColor: string;
}

const BRANDING_STORAGE_KEY = "mikweb_branding";
const DEFAULT_ACCENT = "#3b82f6"; // default blue

/**
 * Apply the accent color as the --primary CSS variable on the document root.
 * Also sets --primary-foreground for text contrast (white on dark, near-black on light).
 */
function applyAccentColor(hex: string) {
  const root = document.documentElement;
  root.style.setProperty("--primary", hex);

  // Determine if color is light or dark to pick contrasting text
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const foreground = luminance > 0.55 ? "oklch(0.13 0 0)" : "oklch(0.98 0 0)";

  root.style.setProperty("--primary-foreground", foreground);

  // Also tint the ring color for focus indicators
  root.style.setProperty("--ring", hex + "80"); // 50% alpha
}

function loadFromStorage(): BrandingConfig | null {
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const defaults: BrandingConfig = {
  providerName: "Seu Provedor",
  logoUrl: "",
  accentColor: DEFAULT_ACCENT,
};

const BrandingContext = createContext<BrandingConfig>(defaults);

export function BrandingProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage for instant availability
  const stored = loadFromStorage();
  const [branding, setBranding] = useState<BrandingConfig>(stored || defaults);

  // Apply accent color on mount and when it changes
  useEffect(() => {
    if (branding.accentColor) {
      applyAccentColor(branding.accentColor);
    }
  }, [branding.accentColor]);

  // Extract dominant color from logo URL
  const updateAccentFromLogo = useCallback(async (logoUrl: string) => {
    if (!logoUrl) return;
    const color = await extractDominantColor(logoUrl);
    if (color) {
      setBranding((prev) => ({ ...prev, accentColor: color }));
      // Update localStorage too
      try {
        const current = loadFromStorage() || defaults;
        current.accentColor = color;
        localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(current));
      } catch {}
    }
  }, []);

  // Extract accent color when logoUrl changes
  useEffect(() => {
    const currentLogo = branding.logoUrl;
    if (currentLogo) {
      updateAccentFromLogo(currentLogo);
    } else {
      // No logo — reset to default accent
      setBranding((prev) => ({ ...prev, accentColor: DEFAULT_ACCENT }));
    }
  }, [branding.logoUrl, updateAccentFromLogo]);

  // Update <title> when providerName changes
  useEffect(() => {
    if (branding.providerName && branding.providerName !== "Seu Provedor") {
      document.title = branding.providerName;
    }
    // Otherwise keep the default title from index.html
  }, [branding.providerName]);

  // Update apple-touch-icon when logoUrl changes (for iOS share sheet)
  useEffect(() => {
    if (!branding.logoUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;

      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 32, 32);

      const dataUrl = canvas.toDataURL("image/png");

      let appleLink = document.querySelector<HTMLLinkElement>("link[rel~='apple-touch-icon']");
      if (!appleLink) {
        appleLink = document.createElement("link");
        appleLink.rel = "apple-touch-icon";
        document.head.appendChild(appleLink);
      }
      appleLink.href = dataUrl;
    };
    img.src = branding.logoUrl;
  }, [branding.logoUrl]);

  // Update theme-color meta tag for browser chrome
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = branding.accentColor || "#000000";
  }, [branding.accentColor]);

  // Keep a ref to the latest accent color so the server-sync effect
  // never uses a stale closure value (avoids race with logo extraction).
  const accentColorRef = useRef(branding.accentColor);
  useEffect(() => {
    accentColorRef.current = branding.accentColor;
  }, [branding.accentColor]);

  // Sync from server in the background — reads accentColorRef for latest value,
  // avoiding the stale closure that would otherwise capture mount-time state.
  useEffect(() => {
    fetch("/api/admin/branding", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.providerName) {
          const fresh: BrandingConfig = {
            providerName: data.providerName,
            logoUrl: data.logoUrl || "",
            accentColor: accentColorRef.current, // latest accent, not stale closure
          };
          setBranding(fresh);
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

export type { BrandingConfig };
