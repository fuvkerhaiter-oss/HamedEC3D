/** Pure mapping from Supabase (PostgREST) rows to domain products. No network imports. */
import { isCurrencyCode, money, type Money } from "../money";
import type { Product } from "./types";

/** Height used for placeholder shapes when a product has no real 3D model yet. */
export const DEFAULT_PLACEHOLDER_HEIGHT_M = 0.25;

export const PRODUCT_SELECT =
  "id,slug,name,description,status,is_mock,category_id," +
  "product_variants(id,sku,name,attributes,is_active,sort_order,variant_prices(currency,amount),inventory(quantity,reserved))," +
  "product_3d_assets(storage_path,height_m,is_primary)," +
  "product_images(storage_path,alt,sort_order,bucket,is_primary,width,height)," +
  "product_shelf_placements(face_id,priority,hidden_in_store)";

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: Product["status"];
  is_mock: boolean;
  category_id: string | null;
  product_variants: {
    id: string;
    sku: string;
    name: string;
    attributes: Record<string, string> | null;
    is_active: boolean;
    sort_order: number;
    variant_prices: { currency: string; amount: number | string }[];
    inventory: One<{ quantity: number; reserved: number }>;
  }[];
  product_3d_assets: { storage_path: string; height_m: number | string; is_primary: boolean }[];
  product_images: { storage_path: string; alt: string; sort_order: number; bucket?: string; is_primary?: boolean; width?: number | null; height?: number | null }[];
  product_shelf_placements?: One<{ face_id: string | null; priority: number; hidden_in_store: boolean }>;
}

/** Images stored by the development media driver (no Supabase keys) are served by /api/media. */
export const LOCAL_MEDIA_BUCKET = "local";

export function publicStorageUrl(supabaseUrl: string, bucket: string, path: string): string {
  if (path.toLowerCase().startsWith("https://")) return path; // externally hosted media (admin "image URL")
  if (bucket === LOCAL_MEDIA_BUCKET) return `/api/media/${path.split("/").map(encodeURIComponent).join("/")}`;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${encoded}`;
}

/** Pure mapping from PostgREST rows to domain products (unit tested). */
export function mapProductRow(row: ProductRow, supabaseUrl: string): Product {
  const asset = row.product_3d_assets.find((a) => a.is_primary) ?? null;
  // Main image first (is_primary), then gallery order.
  const images = [...row.product_images].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || a.sort_order - b.sort_order);
  const gallery = images.map((im) => ({
    url: publicStorageUrl(supabaseUrl, im.bucket ?? "product-images", im.storage_path),
    alt: im.alt || row.name,
    width: im.width ?? null,
    height: im.height ?? null,
  }));
  const shelf = one(row.product_shelf_placements);
  return {
    ...(shelf ? { shelf: { faceId: shelf.face_id, priority: shelf.priority, hiddenInStore: shelf.hidden_in_store } } : {}),
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    categoryId: row.category_id ?? "",
    status: row.status,
    isMock: row.is_mock,
    imageUrl: gallery[0]?.url ?? null,
    gallery,
    asset: {
      glbUrl: asset ? publicStorageUrl(supabaseUrl, "product-models", asset.storage_path) : null,
      heightMeters: asset ? Number(asset.height_m) : DEFAULT_PLACEHOLDER_HEIGHT_M,
    },
    variants: row.product_variants
      .filter((v) => v.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((v) => {
        const inv = one(v.inventory);
        const prices: Money[] = v.variant_prices
          .filter((p) => isCurrencyCode(p.currency))
          .map((p) => money(Number(p.amount), p.currency as Money["currency"]));
        return {
          id: v.id,
          productId: row.id,
          sku: v.sku,
          name: v.name,
          prices,
          stockQuantity: inv ? Math.max(0, inv.quantity - inv.reserved) : 0,
          attributes: v.attributes ?? {},
        };
      }),
  };
}
