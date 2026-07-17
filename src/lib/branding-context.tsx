/**
 * Branding Context — Provides the provider name, logo URL,
 * and accent color (extracted from the logo) to all pages.
 * When the accent color changes, it's applied as the --primary CSS variable
 * so all primary buttons and accents use the logo's dominant color.
 *
 * Loaded from localStorage first (instant),
 * then attempts to sync from the server.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
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
    } else {
      // Fallback to default title
      document.title = "Minha Supernet";
    }
  }, [branding.providerName]);

  // Update favicon when logoUrl changes
  useEffect(() => {
    if (!branding.logoUrl) {
      // No logo — reset favicon to default SVG
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = "/logo.svg";
      link.type = "image/svg+xml";
      return;
    }

    // Convert logo URL to a favicon-friendly format
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Draw the logo onto a 32x32 canvas for a proper favicon
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Use the image as favicon (centered, rounded)
      // Check if image is already square — if so, just scale it
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;

      // Draw and round the corners slightly
      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 32, 32);

      const dataUrl = canvas.toDataURL("image/png");

      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = dataUrl;
      link.type = "image/png";

      // Also update apple-touch-icon for iOS
      let appleLink = document.querySelector<HTMLLinkElement>("link[rel~='apple-touch-icon']");
      if (!appleLink) {
        appleLink = document.createElement("link");
        appleLink.rel = "apple-touch-icon";
        document.head.appendChild(appleLink);
      }
      appleLink.href = dataUrl;
    };
    img.onerror = () => {
      // If the logo fails to load, keep default favicon
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

  // Sync from server in the background
  useEffect(() => {
    fetch("/api/admin/branding", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.providerName) {
          const fresh: BrandingConfig = {
            providerName: data.providerName,
            logoUrl: data.logoUrl || "",
            accentColor: branding.accentColor, // preserve current accent
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
