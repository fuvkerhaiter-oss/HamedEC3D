import type { NextConfig } from "next";

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
    return [
      { source: "/:path*", headers: base },
      { source: "/order", headers: noReferrer },
      { source: "/account/:path*", headers: noReferrer },
    ];
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
};

export default nextConfig;
