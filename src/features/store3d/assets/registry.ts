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
    url: "/models/env/supermarket.opt.glb",
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
    url: "/models/props/trolley.opt.glb",
    purpose: "Customer's shopping trolley pushed in first person; purchased items land in its basket",
    source: "cart_basket.glb",
    scale: 0.01, // authored in centimeters
    rotation: [0, Math.PI, 0], // authored with the front at +Z; the store uses front = -Z
    position: [0, 0, 0],
    castShadow: true,
    receiveShadow: true,
  },
  chain: {
    id: "chain",
    url: "/models/props/chain.opt.glb",
    purpose: "Iron chain segment (1 m along +X) tiled along the chained-off coming-soon portal of the new wing",
    source: "Meshy_AI_Iron_Chain_0927192851_texture.fbx (+ PBR PNGs), converted by tools/assets/fbx-to-glb.mjs",
    scale: 1,
    rotation: [0, 0, 0],
    position: [0, 0, 0],
    castShadow: true,
    receiveShadow: false,
  },
  ps5: {
    id: "ps5",
    url: "/models/props/ps5.opt.glb",
    purpose: "Prize display under the lucky wheel: PS5 retail box (node \"box\", with carry handle) + console (node \"console\")",
    source: "source/PS5_Box.fbx + box.jpeg, converted by tools/assets/fbx-scene-to-glb.mjs (each node stands on y=0, metres)",
    scale: 0.65, // the FBX is ~1.5× real size: console 0.60 m → a real PS5's ~0.39 m
    rotation: [0, 0, 0],
    position: [0, 0, 0],
    castShadow: true,
    receiveShadow: false,
  },
  gta6Case: {
    id: "gta6Case",
    url: "/models/props/gta6-case.opt.glb",
    purpose: "Prize display under the lucky wheel: GTA VI game case (blue case + cover art), lying flat, cover up (+Y)",
    source: "source/Grand Theft Auto 6.gltf (+ .bin, cover jpg, case png), packed by tools/assets/gltf-to-glb.mjs",
    scale: 0.0345, // ≈4.0 × 4.9 units → a real 13.5 × 17 cm case
    rotation: [0, 0, 0],
    position: [0, 0, 0],
    castShadow: true,
    receiveShadow: false,
  },
} as const satisfies Record<string, AssetEntry>;

export type AssetId = keyof typeof ASSETS;
