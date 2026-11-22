import type { Metadata, Viewport } from "next";
import { getCatalog } from "@/lib/catalog/source";
import { getStorefrontSettings } from "@/lib/storefront/settings";
import Link from "next/link";
import { StoreClient } from "@/features/store3d/StoreClient";
import { categoryPath, isIndexable, productPath } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: "Interactive 3D Supermarket · Shop in Your Browser",
  description: "Walk the aisles of the WEGO SHIIIP 3D supermarket in your browser, on computer or phone. Inspect real products, add them to your cart and check out. No download needed.",
  alternates: { canonical: "/store" },
};
// Cached page (ISR, like the homepage): served from the CDN without waking a server function or the database,
// refreshed at most every 60 s and right after admin edits (catalog-actions revalidatePath). If the database
// can't be used during `next build`, it is prerendered without products and fills in on the first refresh
// (lib/catalog/source). Runtime errors go to ./error.tsx and never replace a good cached page.
export const revalidate = 60;
// Game viewport: edge-to-edge (notches handled with safe-area insets), no pinch/double-tap zoom while playing.
export const viewport: Viewport = {
  themeColor: "#111513",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function StorePage() {
  const [{ categories, products }, settings] = await Promise.all([getCatalog(), getStorefrontSettings()]);
  const listed = products.filter((p) => p.status === "published" && (isIndexable(p) || !products.some(isIndexable)));
  return (
    <>
      {/* Same facts as the 3D scene, in HTML: read by screen readers and search engines (the WebGL canvas has no
          crawlable text). Visually hidden only because the full-screen game covers the page; nothing here
          differs from what the store shows. Without JavaScript, the <noscript> note points to the catalog. */}
      <section className="sr-only" aria-labelledby="store-title">
        <h1 id="store-title">WEGO SHIIIP 3D store: walk the aisles and shop in your browser</h1>
        <p>An interactive 3D supermarket. Walk with W A S D (or the left thumb stick on phones), aim at a product and press E (or tap the hand button) to see photos, prices and options, and add it to your cart. Every product is also in the <Link href="/catalog">catalog</Link>. <Link href="/guides/how-to-shop-the-3d-store">How to shop the 3D store</Link>.</p>
        <h2>Departments</h2>
        <ul>{categories.map((c) => <li key={c.id}><Link href={categoryPath(c.slug)}>{c.name}</Link></li>)}</ul>
        <h2>Products on the shelves</h2>
        <ul>{listed.map((p) => <li key={p.id}><Link href={productPath(p.slug)}>{p.name}</Link></li>)}</ul>
      </section>
      <noscript>
        <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <p>The 3D store needs JavaScript and WebGL. <Link href="/catalog">Shop the same products in the catalog</Link>.</p>
        </div>
      </noscript>
      <StoreClient catalog={{ categories, products, stockAllFaces: settings.stockAllFaces, supporters: settings.supporters }} />
    </>
  );
}
