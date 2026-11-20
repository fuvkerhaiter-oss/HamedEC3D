import type { Metadata, Viewport } from "next";
import { getCatalog } from "@/lib/catalog/source";
import { getStorefrontSettings } from "@/lib/storefront/settings";
import { StoreClient } from "@/features/store3d/StoreClient";

export const metadata: Metadata = { title: "Store" };
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
