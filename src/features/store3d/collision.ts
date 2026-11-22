/**
 * Tiny collision for the store (replaces a full physics engine, ~0.8 MB gzipped + WebAssembly start-up).
 * The store is a flat floor with axis-aligned boxes (walls, gondolas, freezers, checkout — see env layout),
 * so the shopper only needs top-down (XZ) collision: a circle (the body) plus a rotated box (the trolley,
 * rigidly attached in front) against axis-aligned rectangles. Moves in small sub-steps (no tunnelling through
 * 0.3 m thick boxes), pushes out along the shortest way (sliding along walls, also after the trolley turns),
 * and removes the velocity component that points into what was hit.
 * Pure and allocation-free per frame (safe inside useFrame).
 */
import type { Box } from "./env/types";

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Body shape in body-local XZ: circle at the origin + box at (offsetX, offsetZ) with half sizes, turning with yaw. */
export interface ShopperShape {
  radius: number;
  box: { offsetX: number; offsetZ: number; halfX: number; halfZ: number };
}

/** Mutable motion state (position + velocity on the floor plane). */
export interface Motion {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Obstacles from layout boxes that stand in the shopper's height range (floor to ~2 m). */
export function rectsFromBoxes(boxes: readonly Box[], minY = 0.05, maxY = 2): Rect[] {
  return boxes
    .filter((b) => b.max[1] > minY && b.min[1] < maxY)
    .map((b) => ({ minX: b.min[0], maxX: b.max[0], minZ: b.min[2], maxZ: b.max[2] }));
}

const MAX_STEP = 0.08; // m per sub-step (< half the thinnest obstacle)
const ITERATIONS = 3;
const SKIN = 1e-4;

// Scratch result of the overlap tests (no allocations).
const hit = { nx: 0, nz: 0, depth: 0 };

/** Circle vs rect: fills `hit` and returns true when they overlap. */
function circleRect(cx: number, cz: number, r: number, b: Rect): boolean {
  const qx = Math.max(b.minX, Math.min(cx, b.maxX));
  const qz = Math.max(b.minZ, Math.min(cz, b.maxZ));
  const dx = cx - qx;
  const dz = cz - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    hit.nx = dx / d;
    hit.nz = dz / d;
    hit.depth = r - d;
    return true;
  }
  // Centre inside the rect: leave through the nearest side.
  const left = cx - b.minX, right = b.maxX - cx, back = cz - b.minZ, front = b.maxZ - cz;
  const m = Math.min(left, right, back, front);
  hit.nx = m === left ? -1 : m === right ? 1 : 0;
  hit.nz = m === back ? -1 : m === front ? 1 : 0;
  if (hit.nx !== 0) hit.nz = 0;
  hit.depth = m + r;
  return true;
}

/** Oriented box (centre, axes u/w, half sizes) vs rect, separating-axis test: fills `hit` on overlap. */
function boxRect(cx: number, cz: number, ux: number, uz: number, hx: number, hz: number, b: Rect): boolean {
  const wx = -uz, wz = ux; // second axis, perpendicular to u
  const bx = (b.minX + b.maxX) / 2, bz = (b.minZ + b.maxZ) / 2;
  const ex = (b.maxX - b.minX) / 2, ez = (b.maxZ - b.minZ) / 2;
  const dx = cx - bx, dz = cz - bz;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const ax = i === 0 ? 1 : i === 1 ? 0 : i === 2 ? ux : wx;
    const az = i === 0 ? 0 : i === 1 ? 1 : i === 2 ? uz : wz;
    const rRect = ex * Math.abs(ax) + ez * Math.abs(az);
    const rBox = hx * Math.abs(ux * ax + uz * az) + hz * Math.abs(wx * ax + wz * az);
    const dist = dx * ax + dz * az;
    const overlap = rRect + rBox - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < best) {
      best = overlap;
      const s = dist < 0 ? -1 : 1;
      hit.nx = ax * s;
      hit.nz = az * s;
    }
  }
  hit.depth = best;
  return true;
}

function pushOut(m: Motion) {
  m.x += hit.nx * (hit.depth + SKIN);
  m.z += hit.nz * (hit.depth + SKIN);
  const into = m.vx * hit.nx + m.vz * hit.nz;
  if (into < 0) {
    m.vx -= into * hit.nx;
    m.vz -= into * hit.nz;
  }
}

/** Push the shopper (at its current yaw) out of every obstacle it overlaps. Returns true if anything was hit. */
export function resolve(m: Motion, yaw: number, shape: ShopperShape, rects: readonly Rect[]): boolean {
  // Three.js yaw about +Y: local (x, z) → world (x·cos + z·sin, −x·sin + z·cos).
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const { offsetX, offsetZ, halfX, halfZ } = shape.box;
  let any = false;
  for (let it = 0; it < ITERATIONS; it++) {
    let moved = false;
    for (const r of rects) {
      if (circleRect(m.x, m.z, shape.radius, r)) {
        pushOut(m);
        moved = true;
      }
      const bx = m.x + offsetX * c + offsetZ * s;
      const bz = m.z - offsetX * s + offsetZ * c;
      if (boxRect(bx, bz, c, -s, halfX, halfZ, r)) {
        pushOut(m);
        moved = true;
      }
    }
    if (!moved) break;
    any = true;
  }
  return any;
}

const MAX_TURN = 0.04; // rad per sub-step: the trolley front (~1.5 m out) sweeps ≤ 6 cm

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Move by velocity × dt while turning from `fromYaw` to `toYaw`, both in small sub-steps, sliding along
 * whatever is in the way. Turning towards a shelf pushes the shopper back instead of swinging the trolley
 * through it. Always resolves at least once.
 */
export function step(m: Motion, fromYaw: number, toYaw: number, dt: number, shape: ShopperShape, rects: readonly Rect[]): void {
  const dist = Math.hypot(m.vx, m.vz) * dt;
  const turn = wrap(toYaw - fromYaw);
  const n = Math.min(200, Math.max(1, Math.ceil(dist / MAX_STEP), Math.ceil(Math.abs(turn) / MAX_TURN)));
  const h = dt / n;
  for (let i = 1; i <= n; i++) {
    m.x += m.vx * h;
    m.z += m.vz * h;
    resolve(m, fromYaw + (turn * i) / n, shape, rects);
  }
}
