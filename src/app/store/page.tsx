import type { Metadata, Viewport } from "next";
import { getCatalog } from "@/lib/catalog/source";
import { getStorefrontSettings } from "@/lib/storefront/settings";
import { StoreClient } from "@/features/store3d/StoreClient";

export const metadata: Metadata = { title: "Store" };
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
  return <StoreClient catalog={{ categories, products, stockAllFaces: settings.stockAllFaces }} />;
}
