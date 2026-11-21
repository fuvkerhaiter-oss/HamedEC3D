import type { MetadataRoute } from "next";

/** Index the live site only; Vercel preview/staging deployments ask search engines to stay out. */
export default function robots(): MetadataRoute.Robots {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const live = process.env.VERCEL_ENV ? process.env.VERCEL_ENV === "production" : process.env.NODE_ENV === "production";
  if (!live) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/checkout", "/order", "/dev/"] },
    sitemap: `${site}/sitemap.xml`,
  };
}
