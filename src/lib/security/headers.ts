/**
 * HTTP security headers (used by next.config.ts) and the site-wide cross-site request guard (used by src/proxy.ts).
 * Pure functions with no Next/alias imports so next.config.ts can load this file directly and tests can cover it.
 */

type Env = Record<string, string | undefined>;

/** The Supabase project origin (REST + Storage over https, Realtime over wss). Falls back to any *.supabase.co. */
function supabaseOrigins(env: Env): string[] {
  try {
    if (env.NEXT_PUBLIC_SUPABASE_URL) {
      const u = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
      return [u.origin, `${u.protocol === "http:" ? "ws:" : "wss:"}//${u.host}`];
    }
  } catch {
    /* malformed URL: generic fallback; check:env reports it */
  }
  return ["https://*.supabase.co", "wss://*.supabase.co"];
}

/**
 * Content-Security-Policy. Blocks scripts from other sites, plugins, <base> hijacking, framing (clickjacking)
 * and forms that post data away. 'unsafe-inline' for scripts is needed by Next's inline bootstrap without
 * per-request nonces (which would force every page to render dynamically); injected markup still cannot load
 * any external script. 'wasm-unsafe-eval' = meshopt/draco WebAssembly decoders of the 3D store.
 * cdn.jsdelivr.net = troika (3D text) fallback-font data; www.gstatic.com = drei's Draco decoder.
 */
export function contentSecurityPolicy(env: Env = process.env): string {
  const dev = env.NODE_ENV !== "production";
  const supabase = supabaseOrigins(env);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // blob: = troika's 3D-text worker loads its own code from a same-origin object URL (only code already
    // running on this page can create one, so it does not admit outside scripts).
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "blob:", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Admins may set https product image URLs from any host.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:", "https://cdn.jsdelivr.net"],
    // blob:/data: = textures embedded in the GLB models (GLTFLoader fetches them as object URLs).
    "connect-src": ["'self'", "blob:", "data:", ...supabase, "https://cdn.jsdelivr.net", "https://www.gstatic.com", ...(dev ? ["ws:", "http://localhost:*", "http://127.0.0.1:*"] : [])],
    "media-src": ["'self'", "blob:", "data:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export type Header = { key: string; value: string };

/** Headers sent on every response. */
export function baseSecurityHeaders(env: Env = process.env): Header[] {
  const prod = env.NODE_ENV === "production";
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // mic: 3D voice chat. Everything else this site never uses is switched off.
    { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(self), accelerometer=(self), microphone=(self), browsing-topics=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    ...(prod ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
  ];
}

/** Admin + API: never indexed, never cached by shared caches or the browser's back/forward cache. */
export const privateHeaders: Header[] = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Server-to-server callers authenticated by signature/secret, not cookies (no CSRF exposure). */
const MACHINE_PATHS = ["/api/webhooks/", "/api/cron/"];

/**
 * CSRF guard for every state-changing request (API routes, server actions, form posts).
 * A browser always sends `Origin` on cross-site POSTs (and `Sec-Fetch-Site`); a mismatch is refused.
 * Requests with neither header are non-browser clients, which cannot ride the visitor's cookies.
 */
export function isCrossSiteRequest(method: string, pathname: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if (MACHINE_PATHS.some((p) => pathname.startsWith(p))) return false;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  if (origin === "null") return true; // sandboxed iframe / data: URL / privacy redirect
  const site = headers.get("sec-fetch-site");
  return site === "cross-site";
}
