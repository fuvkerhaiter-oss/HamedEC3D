/**
 * DEVELOPMENT MOCK DATA ONLY. Generic store-brand items (no real brands) so no real
 * product is misrepresented. All entries have isMock: true and no GLB yet, so the
 * 3D store shows labelled placeholders until real assets are uploaded.
 */
import { money } from "../money";
import type { CatalogReader, Category, Product } from "./types";

export const MOCK_CATEGORIES: Category[] = [
  { id: "cat-pantry", slug: "pantry", name: "Pantry" },
  { id: "cat-drinks", slug: "drinks", name: "Drinks" },
  { id: "cat-snacks", slug: "snacks", name: "Snacks" },
  { id: "cat-household", slug: "household", name: "Household" },
];

type Seed = [slug: string, name: string, categoryId: string, heightM: number, variants: [string, number, number][]];

const SEEDS: Seed[] = [
  ["olive-oil", "Extra Virgin Olive Oil", "cat-pantry", 0.28, [["500 ml", 899, 40], ["1 L", 1499, 12]]],
  ["pasta-penne", "Durum Wheat Penne", "cat-pantry", 0.22, [["500 g", 249, 120]]],
  ["tomato-passata", "Tomato Passata", "cat-pantry", 0.18, [["700 g", 329, 60]]],
  ["sparkling-water", "Sparkling Mineral Water", "cat-drinks", 0.32, [["1.5 L", 129, 200], ["6 × 1.5 L", 699, 30]]],
  ["orange-juice", "Not-From-Concentrate Orange Juice", "cat-drinks", 0.25, [["1 L", 399, 4]]],
  ["cold-brew", "Cold Brew Coffee", "cat-drinks", 0.2, [["330 ml", 349, 0]]],
  ["sea-salt-chips", "Sea Salt Potato Chips", "cat-snacks", 0.3, [["150 g", 279, 80]]],
  ["dark-chocolate", "70% Dark Chocolate", "cat-snacks", 0.16, [["100 g", 299, 55]]],
  ["laundry-liquid", "Laundry Liquid", "cat-household", 0.3, [["1.5 L", 1099, 25]]],
  ["paper-towels", "Paper Towels", "cat-household", 0.28, [["4 rolls", 549, 70]]],
];

export const MOCK_PRODUCTS: Product[] = SEEDS.map(([slug, name, categoryId, heightM, variants]) => {
  const id = `prod-${slug}`;
  return {
    id,
    slug,
    name,
    description: `${name}. Development sample product — replace with real catalog data.`,
    categoryId,
    status: "published",
    imageUrl: null,
    asset: { glbUrl: null, heightMeters: heightM },
    isMock: true,
    variants: variants.map(([vName, price, stock], i) => ({
      id: `${id}-v${i + 1}`,
      productId: id,
      sku: `MOCK-${slug.toUpperCase()}-${i + 1}`,
      name: vName,
      // Mock prices only: EUR shown VAT-inclusive, USD pre-tax.
      prices: [money(price, "EUR"), money(price, "USD")],
      stockQuantity: stock,
      attributes: { size: vName },
    })),
  };
});

export function createMockCatalog(products: Product[] = MOCK_PRODUCTS): CatalogReader {
  return createCatalogReader(products);
}

/** In-memory reader over a loaded product list (mock or Supabase). */
export function createCatalogReader(products: Product[]): CatalogReader {
  const index = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, { product: p, variant: v }] as const)));
  return {
    async getVariant(variantId) {
      return index.get(variantId) ?? null;
    },
  };
}
