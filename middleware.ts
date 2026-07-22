/**
 * Vercel Edge Middleware — Injects dynamic Open Graph tags for social crawlers.
 *
 * Social-media crawlers (WhatsApp, Facebook, Telegram, Twitter, etc.) do NOT
 * execute JavaScript. They only see the static HTML served by Vercel.
 * This middleware detects crawler User-Agents, fetches the provider branding
 * from the Convex backend, and injects the correct <title>, og:title,
 * and og:image meta tags before returning the HTML.
 *
 * Regular users pass through uninterrupted (no performance impact).
 *
 * ── How it works ──
 * 1. Every request enters this middleware.
 * 2. If the URL already has `?__og=1` → pass through (prevents recursion).
 * 3. If the User-Agent matches a known crawler:
 *    a. Fetch the real index.html with `?__og=1` (bypasses middleware).
 *    b. Fetch branding config from Convex HTTP endpoint.
 *    c. Inject <title>, og:title, og:image into the HTML.
 *    d. Return the modified HTML with a short cache-control header.
 * 4. Otherwise → pass through (Return undefined → Vercel continues normally).
 */

// ---------------------------------------------------------------------------
// Known crawler User-Agent patterns
// ---------------------------------------------------------------------------
const CRAWLER_PATTERNS = [
  "facebookexternalhit",
  "Facebot",
  "Twitterbot",
  "WhatsApp",
  "TelegramBot",
  "LinkedInBot",
  "Slackbot",
  "Discordbot",
  "Googlebot",
  "bingbot",
  "DuckDuckBot",
  "Applebot",
  "Pinterest",
  "Slurp", // Yahoo
  "Slack-Img-Proxy",
  "YandexBot",
  "Baiduspider",
  "Sogou",
  "facebookcatalog",
  "MetaInspector",
  "Iframely",
  "PocketParser",
  "WhatsAppProxy",
];

function isCrawler(userAgent: string): boolean {
  const lower = userAgent.toLowerCase();
  return CRAWLER_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Convex branding endpoint
// ---------------------------------------------------------------------------
const CONVEX_SITE_URL =
  process.env.CONVEX_SITE_URL || "https://small-sparrow-797.convex.site";
const BRANDING_URL = `${CONVEX_SITE_URL}/api/admin/branding`;

interface BrandingData {
  providerName?: string;
  logoUrl?: string;
}

async function fetchBranding(): Promise<BrandingData> {
  try {
    const resp = await fetch(BRANDING_URL, {
      signal: AbortSignal.timeout(3000), // 3s timeout — crawlers are impatient
    });
    if (!resp.ok) return {};
    return (await resp.json()) as BrandingData;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Escaping helpers (prevents XSS through provider name or logo URL)
// ---------------------------------------------------------------------------
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export async function middleware(
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);

  // ── Pass-through for internal recursion ──
  if (url.searchParams.has("__og")) {
    return undefined; // Vercel continues normal routing
  }

  // ── Only page-like paths get OG-tag treatment ──
  // Prevents corrupting binary content (PNG, SVG, JS) if a crawler requests
  // a static file like /logo.svg, /logo-192.png, /sw.js, /manifest.webmanifest.
  const path = url.pathname;
  const isPage =
    /^\/?$/.test(path) ||
    /^\/dashboard/.test(path) ||
    /^\/faturas/.test(path) ||
    /^\/perfil/.test(path) ||
    /^\/admin/.test(path) ||
    /^\/login/.test(path);
  if (!isPage) {
    return undefined;
  }

  // ── Check User-Agent ──
  const userAgent = request.headers.get("user-agent") || "";
  if (!isCrawler(userAgent)) {
    return undefined; // Regular user → pass through
  }

  // ── Crawler detected — fetch the real index.html (without middleware) ──
  url.searchParams.set("__og", "1");

  let html: string;
  try {
    const resp = await fetch(url.toString(), {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(5000),
    });
    html = await resp.text();
  } catch {
    // If fetching the page itself fails, just pass through
    return undefined;
  }

  // ── Fetch branding from Convex ──
  const branding = await fetchBranding();
  const providerName = branding.providerName || "Portal do Cliente";
  const logoUrl = branding.logoUrl || "";

  const safeName = escapeHtml(providerName);
  const safeLogo = escapeAttr(logoUrl);

  // ── Inject OG tags into HTML ──

  // 1. Update <title>
  let modified = html.replace(
    /<title>[^<]*<\/title>/i,
    `<title>${safeName}</title>`,
  );

  // 2. Update og:title
  modified = modified.replace(
    /<meta\s+property="og:title"[^>]*\/?>/i,
    `<meta property="og:title" content="${safeName}" />`,
  );

  // 3. Update og:image if we have a logo URL
  if (logoUrl) {
    const ogImageTag = `<meta property="og:image" content="${safeLogo}" />`;

    if (/<meta\s+property="og:image"[^>]*\/?>/i.test(modified)) {
      modified = modified.replace(
        /<meta\s+property="og:image"[^>]*\/?>/i,
        ogImageTag,
      );
    } else {
      // No og:image tag at all — add before </head>
      modified = modified.replace("</head>", `  ${ogImageTag}\n</head>`);
    }
  }

  return new Response(modified, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Cache for 5 minutes, stale for 10 more while revalidating
      "cache-control":
        "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

// ── Only run on page routes (skip API, assets, static files) ──
export const config = {
  matcher: [
    // Match all page-like paths except API, assets, and static files
    "/((?!api/|assets/|_next/).*)",
  ],
};
