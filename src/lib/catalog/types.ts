import type { CurrencyCode, Money } from "../money";

export type ProductStatus = "draft" | "published" | "archived";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface Category {
  id: string;
  slug: string;
  name: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  name: string; // e.g. "500 ml", "Red / M"
  /** One price per sales currency (EUR VAT-inclusive, USD tax-exclusive). */
  prices: Money[];
  /** Units the store can sell right now (server-side truth). */
  stockQuantity: number;
  attributes: Record<string, string>;
}

export interface Product3DAsset {
  /** URL of the optimized GLB. null = no real model yet: show a labelled placeholder + product card. */
  glbUrl: string | null;
  /** Real-world height in meters, used to scale the model. */
  heightMeters: number;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  categoryId: string;
  status: ProductStatus;
  /** Main image (admin-chosen); null = labelled placeholder. */
  imageUrl: string | null;
  /** All product images, main image first, then gallery order. Same data for catalog, product page, 3D store and cart. */
  gallery?: ProductImage[];
  asset: Product3DAsset;
  variants: ProductVariant[];
  /** True for development mock data. Must never be published to a live store. */
  isMock: boolean;
  /** Admin-configured 3D shelf mapping (absent = automatic placement by category). */
  shelf?: ShelfPlacement;
}

export interface ProductImage {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface ShelfPlacement {
  /** Measured gondola face id (e.g. "L1N"); null = automatic by category. */
  faceId: string | null;
  /** Higher = placed first on its face. */
  priority: number;
  /** Sold in the catalog but not shown on a 3D shelf. */
  hiddenInStore: boolean;
}

export function stockStatus(variant: ProductVariant, lowThreshold = 5): StockStatus {
  if (variant.stockQuantity <= 0) return "out_of_stock";
  if (variant.stockQuantity <= lowThreshold) return "low_stock";
  return "in_stock";
}

/** Read-only catalog access used by server-side pricing. Implemented by mock data now, Supabase later. */
export interface CatalogReader {
  getVariant(variantId: string): Promise<{ product: Product; variant: ProductVariant } | null>;
}

export function priceIn(variant: ProductVariant, currency: CurrencyCode): Money | null {
  return variant.prices.find((p) => p.currency === currency) ?? null;
}
