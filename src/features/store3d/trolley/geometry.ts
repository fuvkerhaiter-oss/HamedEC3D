/**
 * Trolley basket logic (pure, no three.js): basket slots for cart units and the flight curve.
 * The trolley itself is the imported model public/models/props/trolley.glb (see assets/registry.ts).
 */
import type { CartLineInput } from "../../../lib/cart/pricing";
import type { Vec3 } from "../layout";

export const TROLLEY = {
  /**
   * Measured from public/models/props/trolley.glb (registry: scale 0.01, yaw 180°), trolley-local meters,
   * origin on the floor under the basket, front = -Z, handle at +Z.
   */
  basket: {
    floorFront: { z: -0.42, y: 0.49 }, // wire floor rises slightly toward the front
    floorBack: { z: 0.24, y: 0.435 },
    halfWidth: 0.18,
    rimY: 0.84,
  },
  /** Trolley origin relative to the player's capsule center (player stands behind the handle). */
  offsetFromPlayer: [0, -0.85, -0.98] as Vec3,
  /** Collider (player-local) so the trolley can't pass through shelves or walls. Model is 0.61 × 1.03 × 1.01 m. */
  collider: { center: [0, -0.32, -0.98] as Vec3, halfExtents: [0.3, 0.42, 0.5] as Vec3 },
  itemScale: 0.85,
  maxVisibleItems: 36,
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Height of the (sloped) basket floor at trolley-local z. */
export function basketFloorY(z: number): number {
  const { floorFront: f, floorBack: b } = TROLLEY.basket;
  return lerp(f.y, b.y, (z - f.z) / (b.z - f.z));
}

/** Resting position (trolley-local, item base center) for the i-th unit: 3 × 4 grid, stacked in layers. */
export function basketSlot(index: number): Vec3 | null {
  if (index < 0 || index >= TROLLEY.maxVisibleItems) return null;
  const COLS = 3;
  const ROWS = 4;
  const perLayer = COLS * ROWS;
  const layer = Math.floor(index / perLayer);
  const i = index % perLayer;
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const { floorFront, floorBack, halfWidth } = TROLLEY.basket;
  const cellW = (halfWidth * 2) / COLS;
  const cellL = (floorBack.z - floorFront.z) / ROWS;
  // Fill from the front (-Z) toward the handle, like a real shopper; odd layers offset so items nest.
  const x = -halfWidth + cellW * (col + 0.5) + (layer % 2) * cellW * 0.25;
  const z = floorFront.z + cellL * (row + 0.5) + (layer % 2) * cellL * 0.2;
  return [x, basketFloorY(z) + 0.008 + layer * 0.15, z];
}

export interface BasketUnit {
  key: string; // `${variantId}#${n}` — stable per unit
  variantId: string;
  productId: string;
}

/** Expand cart lines into individual units (capped), in cart order. */
export function expandUnits(lines: readonly CartLineInput[], productOfVariant: ReadonlyMap<string, string>): BasketUnit[] {
  const out: BasketUnit[] = [];
  for (const line of lines) {
    const productId = productOfVariant.get(line.variantId);
    if (!productId) continue;
    for (let n = 0; n < line.quantity; n++) {
      if (out.length >= TROLLEY.maxVisibleItems) return out;
      out.push({ key: unitKey(line.variantId, n), variantId: line.variantId, productId });
    }
  }
  return out;
}

export const unitKey = (variantId: string, n: number) => `${variantId}#${n}`;

/** Deterministic small yaw jitter so items don't look machine-placed. */
export function unitJitter(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((((h % 1000) + 1000) % 1000) / 1000 - 0.5) * 0.6;
}

// ── Flight animation curve (pure, unit tested) ──

export const FLIGHT = { duration: 0.9, stagger: 0.14, lift: 0.18, arcHeight: 0.55 } as const;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function cubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Pose along the flight at normalized time t ∈ [0,1].
 * Phases: lift off the shelf → arc with spin → drop into the basket → squash & settle.
 */
export function flightPose(from: Vec3, to: Vec3, t: number): { position: Vec3; spin: number; tilt: number; squash: number } {
  const c = Math.min(1, Math.max(0, t));
  const e = easeInOutCubic(c);
  const p1: Vec3 = [from[0], from[1] + FLIGHT.lift + FLIGHT.arcHeight * 0.4, from[2]];
  const p2: Vec3 = [to[0], Math.max(from[1], to[1]) + FLIGHT.arcHeight, to[2]];
  const position: Vec3 = [cubic(from[0], p1[0], p2[0], to[0], e), cubic(from[1], p1[1], p2[1], to[1], e), cubic(from[2], p1[2], p2[2], to[2], e)];
  const spin = e * Math.PI * 2;
  const tilt = Math.sin(c * Math.PI) * 0.45;
  // Landing squash in the last 12%: 1 → 0.88 → 1.
  const land = c > 0.88 ? (c - 0.88) / 0.12 : 0;
  const squash = 1 - Math.sin(land * Math.PI) * 0.12;
  return { position, spin, tilt, squash };
}
