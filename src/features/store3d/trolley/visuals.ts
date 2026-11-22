"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useCart } from "@/features/cart/cart-store";
import { categoryColor } from "@/lib/catalog/colors";
import { productItemDims } from "../layout";
import type { StoreCatalog } from "../StoreScene";
import { expandUnits } from "./geometry";

export interface TrolleyCatalog {
  visuals: ReadonlyMap<string, { color: string; h: number; w: number }>;
  productOfVariant: ReadonlyMap<string, string>;
}

/** `colors` = the shelf layout's per-product colours, so a product looks the same on the shelf and in any trolley. */
export function buildTrolleyCatalog(catalog: StoreCatalog, colors: Readonly<Record<string, string>> = {}): TrolleyCatalog {
  const cat = new Map(catalog.categories.map((c, i) => [c.id, categoryColor(c.slug, i)]));
  const visuals = new Map<string, { color: string; h: number; w: number }>();
  const productOfVariant = new Map<string, string>();
  for (const p of catalog.products) {
    visuals.set(p.id, { color: colors[p.id] ?? cat.get(p.categoryId) ?? categoryColor(undefined), ...productItemDims(p.asset.heightMeters) });
    for (const v of p.variants) productOfVariant.set(v.id, p.id);
  }
  return { visuals, productOfVariant };
}

/** Units currently in the cart, in basket order (shared by resting items and flights). */
export function useBasketUnits(tc: TrolleyCatalog) {
  const lines = useCart((s) => s.lines);
  return useMemo(() => expandUnits(lines, tc.productOfVariant), [lines, tc.productOfVariant]);
}

// Shared GPU resources: one box geometry, one material per color.
export const ITEM_BOX = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map<string, THREE.MeshStandardMaterial>();
export function itemMaterial(color: string): THREE.MeshStandardMaterial {
  let m = materials.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    materials.set(color, m);
  }
  return m;
}
