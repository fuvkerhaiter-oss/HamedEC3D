/**
 * Sample (is_mock) products are development data. In production they are hidden from the storefront, the 3D store,
 * the sitemap and search, and cannot be priced or ordered, unless SHOW_SAMPLE_PRODUCTS=true is set on purpose
 * (labelled demo/test deployments, e2e). Outside production they stay visible with their "Sample" label.
 */
import type { Product } from "./types";

export function sampleProductsAllowed(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  if (env.NODE_ENV !== "production") return true;
  return env.SHOW_SAMPLE_PRODUCTS === "true";
}

/** Drops sample products when they may not be shown. */
export function withoutHiddenSamples<T extends Pick<Product, "isMock">>(products: readonly T[], env: Partial<NodeJS.ProcessEnv> = process.env): T[] {
  return sampleProductsAllowed(env) ? [...products] : products.filter((p) => !p.isMock);
}
