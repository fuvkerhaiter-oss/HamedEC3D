import { SHOP_ROOM, SHOP_UNITS } from "@/features/store3d/env/shops";
import { shopWhere, type PublicShop, type PublicStorefront } from "@/features/rentals/format";
import { loadDoorStyles, loadStorefronts } from "../tenants/service";
import { getSql, isDbConfigured } from "../db/client";
import { logError } from "../log";
import { allShopStates, type ShopState } from "./availability";
import type { DoorStyle } from "./door-style";
import { getShopStates } from "./service";

export function toPublicShops(states: readonly ShopState[], storefronts: Record<string, PublicStorefront> = {}, doors: Record<string, DoorStyle> = {}): PublicShop[] {
  return SHOP_UNITS.map((u) => {
    const s = states.find((x) => x.shopId === u.id) ?? { shopId: u.id, state: "available" as const };
    return {
      id: u.id,
      label: u.label,
      where: shopWhere(u),
      widthM: Math.round((u.roomX1 - u.roomX0) * 10) / 10,
      depthM: SHOP_ROOM.depth,
      state: s.state,
      until: s.state === "available" ? null : s.until.toISOString(),
      brand: s.state === "rented" ? s.brand : null,
      storefront: s.state === "rented" ? (storefronts[u.id] ?? null) : null,
      door: s.state === "rented" ? (doors[u.id] ?? null) : null,
    };
  });
}

/** Live shop availability; without a database (or on a DB error) every shop shows as available. */
export async function loadPublicShops(): Promise<PublicShop[]> {
  if (!isDbConfigured()) return toPublicShops(allShopStates([]));
  try {
    const sql = getSql();
    const [states, storefronts, doors] = await Promise.all([
      getShopStates(sql),
      loadStorefronts(sql).catch((e) => {
        logError("tenant storefronts failed", e);
        return {};
      }),
      loadDoorStyles(sql).catch((e) => {
        logError("shop door styles failed", e);
        return {};
      }),
    ]);
    return toPublicShops(states, storefronts, doors);
  } catch (e) {
    logError("rental shop states failed", e);
    return toPublicShops(allShopStates([]));
  }
}
