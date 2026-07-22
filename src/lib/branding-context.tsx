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
 * Generate an inline SVG Wi‑Fi icon as the default favicon — used when no
 * provider logo is configured. Three arcs + a dot, rendered in a neutral gray.
 */
function generateWifiFavicon(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.5" stroke-linecap="round">
  <path d="M4 10a10 10 0 0 1 16 0"/>
  <path d="M8 15.5a5 5 0 0 1 8 0"/>
  <circle cx="12" cy="20.5" r="1.5" fill="#6b7280" stroke="none"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Generate an inline SVG favicon placeholder — a colored circle using the
 * accent color. This is set synchronously (no network, no canvas) so the
 * browser tab never shows a generic or missing icon while the real logo loads.
 */
function generatePlaceholderFavicon(color: string): string {
  // A 32×32 square with a filled circle, scaled for crisp rendering at 16px
  // encodeURIComponent handles the # → %23 encoding; no need to pre-encode.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="14" fill="${color}"/>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

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

  // Helper: draw the logo onto a canvas at the given size and return a data URL.
  // Square (no clip) by default; pass clipCircle=true to clip into a circle.
  const logoToDataUrl = useCallback(
    (size: number, clipCircle: boolean): Promise<string | null> =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              resolve(null);
              return;
            }

            const srcSize = Math.min(img.width, img.height);
            const sx = (img.width - srcSize) / 2;
            const sy = (img.height - srcSize) / 2;

            if (clipCircle) {
              ctx.beginPath();
              ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
              ctx.closePath();
              ctx.clip();
            }

            ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, size, size);
            resolve(canvas.toDataURL("image/png"));
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = branding.logoUrl;
      }),
    [branding.logoUrl],
  );

  // Shared helper: update both <link rel="icon"> and <link rel="shortcut icon">
  // with the given href, optionally setting a MIME type.
  const setFaviconHref = useCallback((href: string, mimeType?: string) => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    if (mimeType) link.type = mimeType;
    link.href = href;

    let shortcutLink = document.querySelector<HTMLLinkElement>("link[rel='shortcut icon']");
    if (!shortcutLink) {
      shortcutLink = document.createElement("link");
      shortcutLink.rel = "shortcut icon";
      document.head.appendChild(shortcutLink);
    }
    shortcutLink.href = href;
  }, []);

  // When no provider logo is configured, show a Wi‑Fi icon as the default
  // favicon (replaces the generic /logo.svg from index.html).
  useEffect(() => {
    if (branding.logoUrl) return;

    const wifiUrl = generateWifiFavicon();
    setFaviconHref(wifiUrl, "image/svg+xml");
  }, [branding.logoUrl, setFaviconHref]);

  // Set a placeholder favicon (colored circle from accent color) the moment
  // logoUrl is known, before the actual logo image finishes loading.
  // This runs synchronously in the effect, so the browser tab never flickers
  // between the generic default and the real logo.
  useEffect(() => {
    if (!branding.logoUrl) return;

    const placeholderColor = branding.accentColor || DEFAULT_ACCENT;
    const placeholderUrl = generatePlaceholderFavicon(placeholderColor);

    setFaviconHref(placeholderUrl, "image/svg+xml");
  }, [branding.logoUrl, branding.accentColor, setFaviconHref]);

  // Separate generation counters — prevents stale async resolutions from
  // overwriting newer favicon/apple-icon when `logoUrl` changes mid-flight.
  // Each async effect has its own counter so they never invalidate each other.
  const faviconGenRef = useRef(0);
  const appleIconGenRef = useRef(0);
  const manifestGenRef = useRef(0);

  // Replace the placeholder with the actual logo as a PNG (from canvas).
  // Runs asynchronously — the real logo may take a moment to download/decode.
  useEffect(() => {
    if (!branding.logoUrl) return;

    const gen = ++faviconGenRef.current;

    logoToDataUrl(32, false).then((dataUrl) => {
      if (!dataUrl || gen !== faviconGenRef.current) return; // stale
      setFaviconHref(dataUrl, "image/png");
    });
  }, [branding.logoUrl, logoToDataUrl, setFaviconHref]);

  // Update ALL apple-touch-icon links when logoUrl changes.
  // iOS uses these for the home-screen icon (needs 180px minimum).
  // We update every existing <link rel="apple-touch-icon"> so that
  // all size variants point to the provider logo.
  useEffect(() => {
    if (!branding.logoUrl) return;

    const gen = ++appleIconGenRef.current;

    logoToDataUrl(180, true).then((dataUrl) => {
      if (!dataUrl || gen !== appleIconGenRef.current) return; // stale

      const links = document.querySelectorAll<HTMLLinkElement>("link[rel~='apple-touch-icon']");
      if (links.length === 0) {
        const link = document.createElement("link");
        link.rel = "apple-touch-icon";
        link.href = dataUrl;
        document.head.appendChild(link);
      } else {
        links.forEach((link) => {
          link.href = dataUrl;
        });
      }
    });
  }, [branding.logoUrl, logoToDataUrl]);

  // ── Open Graph meta tags ──────────────────────────────────────────────
  // Update og:title, og:description, og:image, and og:site_name so that
  // in-browser share sheets (Web Share API) show the correct provider info.
  //
  // Note: social-media crawlers (WhatsApp, Facebook, Telegram) do NOT execute
  // JavaScript, so they will only see the static fallback in index.html.
  // For crawler-perfect previews, a Vercel serverless function or middleware
  // that injects the provider branding into the HTML at request time is needed.
  useEffect(() => {
    const setMeta = (prop: string, content: string) => {
      let tag = document.querySelector<HTMLMetaElement>(`meta[property="${prop}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute("property", prop);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };

    setMeta("og:title", branding.providerName);

    if (branding.logoUrl) {
      setMeta("og:image", branding.logoUrl);
    }
    // When no logoUrl, keep the static Wi‑Fi fallback from index.html
  }, [branding.providerName, branding.logoUrl]);

  // ── Cache the logo image for offline use ────────────────────────────
  // Uses the Cache API directly (same cache the SW reads from) so the
  // logo is available offline regardless of whether the SW is active yet.
  useEffect(() => {
    if (!branding.logoUrl) return;

    async function cacheLogo() {
      if (!("caches" in window)) return;
      try {
        const cache = await caches.open("portal-cliente-v1");
        // Only cache if not already cached (avoid redundant fetch)
        const existing = await cache.match(branding.logoUrl);
        if (existing) return;

        const response = await fetch(branding.logoUrl, { mode: "cors" });
        if (response.ok) {
          await cache.put(branding.logoUrl, response);
        }
      } catch {
        // Offline or invalid URL — silently ignore
      }
    }

    cacheLogo();
  }, [branding.logoUrl]);

  // ── Dynamic PWA Manifest ────────────────────────────────────────────
  // When the provider logo is known, generate a manifest with data-URL
  // icons so Android/Chrome PWA install uses the correct logo.
  useEffect(() => {
    if (!branding.logoUrl) return;

    const gen = ++manifestGenRef.current;

    // Generate both sizes, then compose and inject the manifest
    Promise.all([
      logoToDataUrl(192, false),
      logoToDataUrl(512, false),
    ]).then(([icon192, icon512]) => {
      if (gen !== manifestGenRef.current) return; // stale
      if (!icon192 || !icon512) return;

      const manifest = {
        name: branding.providerName,
        short_name: branding.providerName.slice(0, 12),
        description: `Portal do Cliente — ${branding.providerName}`,
        start_url: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#fafafa",
        theme_color: branding.accentColor || "#fafafa",
        scope: "/",
        lang: "pt-BR",
        icons: [
          { src: icon192, sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: icon512, sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      };

      const blob = new Blob([JSON.stringify(manifest)], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const link = document.querySelector<HTMLLinkElement>("link[rel='manifest']");
      if (link) {
        const old = link.href;
        link.href = url;
        if (old.startsWith("blob:")) URL.revokeObjectURL(old);
      }
    });
  }, [branding.logoUrl, branding.providerName, branding.accentColor, logoToDataUrl]);

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
