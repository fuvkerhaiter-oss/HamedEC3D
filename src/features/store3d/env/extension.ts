/**
 * The store extension ("new wing"): the imported supermarket's far wall (x ≈ 14.1) is cut out at load time and
 * the hall continues for another ~20 m. Some fixtures of the imported store are removed (FIXTURE_REMOVALS).
 * Past the hall, behind a chained-off portal, is the "Coming soon" wing.
 *
 * Pure data + math (no three.js scene objects), shared by the renderer (reshape.ts, wing/*), the collision setup
 * and unit tests.
 */
import type { Box, EnvLayout, Vec3 } from "./types";
import { CHRISTMAS_ON, christmasColliders } from "./christmas";

/** Inner face of the removed far wall in supermarket.glb. */
export const OLD_END_X = 14.145;
/** Anything entirely beyond this x in the imported model is the old far wall (cut away). */
export const CUT_X = 14.1;
/** New far wall (inner face). */
export const NEW_END_X = 34.2;
/** The chained portal between the open hall and the coming-soon wing. */
export const GATE_X = 25.2;
/** Portal pillars + bulkhead. */
export const GATE = { pillarDepth: 0.7, pillarWidth: 1.1, bulkheadBottom: 3.45 } as const;
/**
 * Free-standing "Who supported us from the beginning" sign in the new hall, beside the updates board, facing back
 * toward the old store (yaw: rotation about Y; its face looks along (sin yaw, cos yaw)). Admin content: /admin/supporters.
 */
export const SUPPORTERS_STAND = { x: 21.0, z: 5.0, yaw: -2.0, width: 2.6, depth: 0.6 } as const;

/** Walk-blocking box around the sign's base (axis-aligned bounds of its rotated footprint). */
export function supportersStandCollider(): Box {
  const { x, z, yaw, width, depth } = SUPPORTERS_STAND;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hx = (width / 2) * c + (depth / 2) * s;
  const hz = (width / 2) * s + (depth / 2) * c;
  return { min: [x - hx, 0, z - hz], max: [x + hx, 2, z + hz] };
}
/**
 * Big "lucky wheel" with the supporters' names, against the north wall of the new hall between the old store and the
 * supporters sign (moved there on the owner's request, 2026-11-27), facing into the hall and slightly toward the
 * shopper who walks in from the old store (same yaw convention). Its footprint stays clear of the sign and the north
 * wall. Footprint in
 * wheel-local metres: ±halfWidth across, `back` behind and `front` in front of the wheel face (covers the stand + the
 * "coming soon" rope and sign).
 */
export const LUCKY_WHEEL = { x: 17.6, z: 6.65, yaw: -2.73, halfWidth: 1.6, back: 0.7, front: 1.35 } as const;

/** Walk-blocking box around the wheel, its rope and sign (axis-aligned bounds of the rotated footprint). */
export function luckyWheelCollider(): Box {
  const { x, z, yaw, halfWidth, back, front } = LUCKY_WHEEL;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Local x axis → world (cos, −sin); local z axis (the face direction) → world (sin, cos).
  const corners = [[-halfWidth, -back], [halfWidth, -back], [halfWidth, front], [-halfWidth, front]].map(([lx, lz]) => [x + lx! * c + lz! * s, z - lx! * s + lz! * c] as const);
  const xs = corners.map((p) => p[0]);
  const zs = corners.map((p) => p[1]);
  return { min: [Math.min(...xs), 0, Math.min(...zs)], max: [Math.max(...xs), 2, Math.max(...zs)] };
}
/**
 * "What's new / coming soon" display (wing/UpdatesBoard): a fixed free-standing screen wall in front of the chained
 * gate, facing back down the hall. Its x is past shop 04's door (env/shops.ts), so it never stands between the hall
 * and that shop. Centre z = hall centre + zOffset; width runs across the hall, depth is the plinth.
 */
export const UPDATES_DISPLAY = { x: GATE_X - 1.3, zOffset: -0.3, width: 7.6, depth: 0.6 } as const;

/** Walk-blocking box around the display's plinth. */
export function updatesDisplayCollider(env: EnvLayout): Box {
  const { x, zOffset, width, depth } = UPDATES_DISPLAY;
  const zc = (env.interior.min[2] + env.interior.max[2]) / 2 + zOffset;
  return { min: [x - depth / 2, 0, zc - width / 2], max: [x + depth / 2, 2, zc + width / 2] };
}
export const WALL_T = 0.3;

/**
 * Fixtures of the imported store removed on the owner's request (2026-11-26): the two low chest-freezer counters
 * along the side walls (where the rental shop fronts are, env/shops.ts) and both refrigerated display-cabinet banks
 * of the old far wall (they had been moved into the new hall; the owner asked for all of them to go). Triangles whose centroid lies in the region
 * (minY..maxY keeps the floor and the wall) are dropped at load (env/reshape.ts); the collider leaves the layout.
 */
export interface FixtureRemoval {
  id: string;
  region: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  collider: Box;
}
export const FIXTURE_REMOVALS: FixtureRemoval[] = [
  {
    id: "freezer-north",
    region: { minX: -0.45, maxX: 8.65, minY: 0.1, maxY: 1.1, minZ: 7.1, maxZ: 8.1 },
    collider: { min: [-0.354, 0.196, 7.174], max: [8.572, 0.998, 8.082] },
  },
  {
    id: "freezer-south",
    region: { minX: 7.4, maxX: 12.9, minY: 0.1, maxY: 1.1, minZ: -6.55, maxZ: -5.45 },
    collider: { min: [7.466, 0.196, -6.411], max: [12.814, 0.998, -5.502] },
  },
  {
    id: "fridges-long",
    region: { minX: 12.2, maxX: 14.2, minY: 0.02, maxY: 2.7, minZ: -5.4, maxZ: 3.58 },
    collider: { min: [12.275, 0.027, -5.296], max: [14.126, 2.524, 3.563] },
  },
  {
    id: "fridges-short",
    region: { minX: 12.2, maxX: 14.2, minY: 0.02, maxY: 2.7, minZ: 3.58, maxZ: 8.1 },
    collider: { min: [13.251, 0.027, 3.6], max: [14.126, 2.524, 8.016] },
  },
];

export function fixtureRemovalFor(cx: number, cy: number, cz: number): FixtureRemoval | null {
  for (const f of FIXTURE_REMOVALS) {
    const r = f.region;
    if (cx >= r.minX && cx <= r.maxX && cy >= r.minY && cy <= r.maxY && cz >= r.minZ && cz <= r.maxZ) return f;
  }
  return null;
}

const sameBox = (a: Box, b: Box) => a.min.every((v, i) => Math.abs(v - b.min[i]!) < 1e-3) && a.max.every((v, i) => Math.abs(v - b.max[i]!) < 1e-3);
const box = (min: Vec3, max: Vec3): Box => ({ min, max });

/** Walk-blocking boxes of the new hall + wing (walls, portal pillars, chain barrier). */
export function extensionColliders(env: EnvLayout): Box[] {
  const z0 = env.interior.min[2];
  const z1 = env.interior.max[2];
  const h = 4;
  const g = GATE_X;
  return [
    box([OLD_END_X - 0.2, 0, z0 - WALL_T], [NEW_END_X + WALL_T, h, z0]), // south wall
    box([OLD_END_X - 0.2, 0, z1], [NEW_END_X + WALL_T, h, z1 + WALL_T]), // north wall
    box([NEW_END_X, 0, z0 - WALL_T], [NEW_END_X + WALL_T, h, z1 + WALL_T]), // far wall
    box([g - GATE.pillarDepth / 2, 0, z0], [g + GATE.pillarDepth / 2, h, z0 + GATE.pillarWidth]), // pillars
    box([g - GATE.pillarDepth / 2, 0, z1 - GATE.pillarWidth], [g + GATE.pillarDepth / 2, h, z1]),
    // The chains: nobody walks into the wing yet (a little in front of the stanchions so the trolley stops at them).
    box([g - 0.55, 0, z0], [g - 0.25, 1.2, z1]),
    supportersStandCollider(), // supporters sign
    luckyWheelCollider(), // lucky wheel
    updatesDisplayCollider(env), // updates display in front of the gate
  ];
}

/** The supermarket layout with the far wall and the removed fixtures gone and the extension added. */
export function extendLayout(env: EnvLayout): EnvLayout {
  const farWall = (w: Box) => w.min[0] >= OLD_END_X - 0.01;
  const walls = env.walls.filter((w) => !farWall(w)).map((w) => {
    // Side walls now run on to the new far wall.
    if (w.max[0] >= OLD_END_X && w.min[0] < OLD_END_X) return { min: w.min, max: [NEW_END_X + WALL_T, w.max[1], w.max[2]] as Vec3 };
    return w;
  });
  const fixtures = env.fixtures.filter((b) => !FIXTURE_REMOVALS.some((f) => sameBox(f.collider, b)));
  return {
    ...env,
    interior: { min: env.interior.min, max: [NEW_END_X, env.interior.max[1], env.interior.max[2]] },
    walls: [...walls, ...extensionColliders(env), ...(CHRISTMAS_ON ? christmasColliders() : [])],
    fixtures,
  };
}
