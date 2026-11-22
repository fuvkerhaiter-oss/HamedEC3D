/**
 * The store extension ("new wing"): the imported supermarket's far wall (x ≈ 14.1) is cut out at load time and
 * the hall continues for another ~20 m. The two fridge banks that stood against that wall are moved (not deleted)
 * onto the side walls of the new hall. Past the hall, behind a chained-off portal, is the "Coming soon" wing.
 *
 * Pure data + math (no three.js scene objects), shared by the renderer (reshape.ts, wing/*), the collision setup
 * and unit tests.
 */
import type { Box, EnvLayout, Vec3 } from "./types";

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
export const WALL_T = 0.3;

/**
 * Fridge banks of the old far wall, by the region their geometry occupies in supermarket.glb, and where they go.
 * `rotationY` turns the bank (originally facing -X) to face into the new hall; `offset` is applied after it.
 * Rotation about +Y by θ: x' = x·cosθ + z·sinθ, z' = −x·sinθ + z·cosθ.
 */
export interface FridgeMove {
  id: string;
  /** Triangles whose centroid lies in this region (x/z, y < 2.7) belong to the bank. */
  region: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Collider of the bank in the original layout. */
  collider: Box;
  rotationY: number;
  offset: [number, number];
}

export const FRIDGE_MOVES: FridgeMove[] = [
  {
    // 8.9 m bank → south wall of the new hall, facing +Z.
    id: "fridges-long",
    region: { minX: 12.2, maxX: 14.2, minZ: -5.4, maxZ: 3.58 },
    collider: { min: [12.275, 0.027, -5.296], max: [14.126, 2.524, 3.563] },
    rotationY: Math.PI / 2,
    offset: [20.9, 7.49],
  },
  {
    // 4.4 m bank → north wall of the new hall, facing -Z.
    id: "fridges-short",
    region: { minX: 12.2, maxX: 14.2, minZ: 3.58, maxZ: 8.1 },
    collider: { min: [13.251, 0.027, 3.6], max: [14.126, 2.524, 8.016] },
    rotationY: -Math.PI / 2,
    offset: [27.6, -6.09],
  },
];

const ALL_FRIDGE_REGION_MAX_Y = 2.7;

export function fridgeMoveFor(cx: number, cy: number, cz: number): FridgeMove | null {
  if (cy > ALL_FRIDGE_REGION_MAX_Y) return null;
  for (const f of FRIDGE_MOVES) {
    const r = f.region;
    if (cx >= r.minX && cx <= r.maxX && cz >= r.minZ && cz < r.maxZ) return f;
  }
  return null;
}

/** Move a point (x, z) of a fridge bank to its new place. */
export function moveXZ(f: FridgeMove, x: number, z: number): [number, number] {
  const c = Math.cos(f.rotationY);
  const s = Math.sin(f.rotationY);
  return [x * c + z * s + f.offset[0], -x * s + z * c + f.offset[1]];
}

function movedBox(f: FridgeMove): Box {
  const { min, max } = f.collider;
  const a = moveXZ(f, min[0], min[2]);
  const b = moveXZ(f, max[0], max[2]);
  return {
    min: [Math.min(a[0], b[0]), min[1], Math.min(a[1], b[1])],
    max: [Math.max(a[0], b[0]), max[1], Math.max(a[1], b[1])],
  };
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
  ];
}

/** The supermarket layout with the far wall removed, the fridge banks moved and the extension added. */
export function extendLayout(env: EnvLayout): EnvLayout {
  const farWall = (w: Box) => w.min[0] >= OLD_END_X - 0.01;
  const walls = env.walls.filter((w) => !farWall(w)).map((w) => {
    // Side walls now run on to the new far wall.
    if (w.max[0] >= OLD_END_X && w.min[0] < OLD_END_X) return { min: w.min, max: [NEW_END_X + WALL_T, w.max[1], w.max[2]] as Vec3 };
    return w;
  });
  const fixtures = env.fixtures.filter((b) => !FRIDGE_MOVES.some((f) => sameBox(f.collider, b)));
  return {
    ...env,
    interior: { min: env.interior.min, max: [NEW_END_X, env.interior.max[1], env.interior.max[2]] },
    walls: [...walls, ...extensionColliders(env)],
    fixtures: [...fixtures, ...FRIDGE_MOVES.map(movedBox)],
  };
}
