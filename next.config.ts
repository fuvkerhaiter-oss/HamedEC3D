import type { NextConfig } from "next";

const PUBLIC_MEDIA_BUCKETS = ["products", "product-images"];

function supabaseImagePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  let host = "*.supabase.co";
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;
  } catch {
    /* malformed URL: keep the generic pattern; check:env reports it */
  }
  return PUBLIC_MEDIA_BUCKETS.map((b) => ({ protocol: "https" as const, hostname: host, pathname: `/storage/v1/object/public/${b}/**` }));
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root: a stray lockfile in the user's home directory otherwise confuses Turbopack.
  turbopack: { root: process.cwd() },
  // Baseline security headers. HSTS only in production (HTTPS). Order/account pages carry signed tokens in
  // the URL: no Referer is sent from them (e.g. when the customer opens a carrier tracking link).
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), microphone=(self)" }, // mic: 3D voice chat
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
    ];
    const noReferrer = [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store" }];
    // Big public 3D/audio files (not hashed by the bundler; Next serves /public with max-age=0 by default →
    // a revalidation round-trip on every visit). Cached 7 days, then revalidated in the background.
    // To change one of these files, give it a NEW name (e.g. supermarket.v2.glb) and update the registry.
    const publicAsset = [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }];
    return [
      { source: "/:path*", headers: base },
      { source: "/models/:path*", headers: publicAsset },
      { source: "/audio/:path*", headers: publicAsset },
      { source: "/brand/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      { source: "/order", headers: noReferrer },
      { source: "/account/:path*", headers: noReferrer },
    ];
  },
  images: {
    // Only this project's PUBLIC product buckets can be resized (a wildcard would let anyone use our optimizer
    // as a free proxy for any Supabase project). Private buckets are never routed through the optimizer.
    remotePatterns: supabaseImagePatterns(),
    // Product photos are stored under unique, never-reused names (replacing a photo = new name), so optimized
    // copies can be cached long. Uploads also carry max-age=1y, which the optimizer honors; this is the floor
    // for legacy files without a header.
    minimumCacheTTL: 86400,
    // Widths used by our `sizes`; fewer distinct widths = fewer transformations and fewer original fetches.
    deviceSizes: [640, 828, 1080, 1200, 1920],
    imageSizes: [64, 96, 128, 256, 384],
  },
};

export default nextConfig;
