/**
 * Central registry of imported 3D assets. Every model used in the store is listed here with the
 * transform that maps it into scene meters (Y-up). Optimized copies live in public/models/;
 * originals stay untouched in "3D models/". See ASSET_INVENTORY.md.
 */
import type { Vec3 } from "../env/types";

export interface AssetEntry {
  id: string;
  url: string;
  purpose: string;
  source: string; // original file in "3D models/"
  scale: number;
  rotation: Vec3; // radians, applied after scale
  position: Vec3;
  castShadow: boolean;
  receiveShadow: boolean;
}

export const ASSETS = {
  supermarket: {
    id: "supermarket",
    url: "/models/env/supermarket.glb",
    purpose: "Store architecture and fixtures: walls, floor, ceiling, 6 gondola runs, wall racks, freezers, checkout, entrance trolleys",
    source: "super_market_for_free.glb",
    scale: 1,
    rotation: [0, 0, 0],
    position: [0, 0, 0],
    castShadow: false, // 210k tris: receive only; products and trolley cast
    receiveShadow: true,
  },
  trolley: {
    id: "trolley",
    url: "/models/props/trolley.glb",
    purpose: "Customer's shopping trolley pushed in first person; purchased items land in its basket",
    source: "cart_basket.glb",
    scale: 0.01, // authored in centimeters
    rotation: [0, Math.PI, 0], // authored with the front at +Z; the store uses front = -Z
    position: [0, 0, 0],
    castShadow: true,
    receiveShadow: true,
  },
} as const satisfies Record<string, AssetEntry>;

export type AssetId = keyof typeof ASSETS;
