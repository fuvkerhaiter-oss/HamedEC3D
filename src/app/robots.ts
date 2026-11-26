import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/site";

/** Index the live site only; Vercel preview/staging deployments ask search engines to stay out. */
export default function robots(): MetadataRoute.Robots {
  const site = siteUrl();
  const live = process.env.VERCEL_ENV ? process.env.VERCEL_ENV === "production" : process.env.NODE_ENV === "production";
  if (!live) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    // Private / transactional areas (those pages also send noindex). Not blocked on purpose:
    // - catalog search/filter URLs: they carry noindex + a canonical, which crawlers only see if allowed in;
    // - /_next/image and /_next/static: product photos and CSS/JS that Google needs to render pages.
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/checkout", "/order", "/account", "/seller", "/dev/"] },
    sitemap: `${site}/sitemap.xml`,
  };
}
