/**
 * Layout of a rental shop's room (pure data + math, no three.js): the unit's local frame, the room box, where the
 * gondolas, wall shelving, counter, podiums and brand plinth stand, the product slots on the gondola shelves, and
 * the walk-blocking boxes used when a rented shop is open to shoppers. Shared by wing/RentalShops (rendering),
 * wing/TenantProducts, StoreExperience (collisions) and tests.
 *
 * Local frame: origin at the door's centre on the wall's inner face, +z into the store, +x to the right when facing
 * the shop from the store, y up. The wall is `t` thick (local z 0 → −t); the room is behind it (z −t → −t − depth).
 */
import type { Box } from "./types";
import { SHOP_DOOR, SHOP_ROOM, wallOf, type ShopUnit } from "./shops";

export type V3 = [number, number, number];

export interface UnitFrame {
  position: V3;
  rotationY: number;
  t: number;
  /** Room extent in local x. */
  rx0: number;
  rx1: number;
  /** Local x span of the room's own front (where no store wall stands in front of it). */
  front?: [number, number];
}

export function unitFrame(u: ShopUnit): UnitFrame {
  const wall = wallOf(u);
  const t = Math.abs(wall.outer - wall.inner);
  // South wall: local = world (+z into the store). North wall: half turn.
  const flip = u.side === "N";
  const lx = (x: number) => (flip ? u.x - x : x - u.x);
  const span = (a: number, b: number): [number, number] => [Math.min(lx(a), lx(b)), Math.max(lx(a), lx(b))];
  const [rx0, rx1] = span(u.roomX0, u.roomX1);
  return { position: [u.x, 0, wall.inner], rotationY: flip ? Math.PI : 0, t, rx0, rx1, front: u.frontWall && span(...u.frontWall) };
}

export function toWorld(f: UnitFrame, [x, y, z]: V3): V3 {
  const c = Math.cos(f.rotationY);
  const s = Math.sin(f.rotationY);
  return [f.position[0] + x * c + z * s, y, f.position[2] - x * s + z * c];
}

/** Rooms stop this short of their partition line, so neighbouring rooms never share (and z-fight on) a plane. */
export const PARTITION = 0.1;

/** Inside of a unit's room in its local frame: walls xl/xr, front zf (wall's outer face), back zb, height h. */
export function roomDims(f: UnitFrame) {
  const xl = f.rx0 + PARTITION;
  const xr = f.rx1 - PARTITION;
  const zf = -f.t;
  return { xl, xr, cx: (xl + xr) / 2, w: xr - xl, zf, zb: zf - SHOP_ROOM.depth, h: SHOP_ROOM.height };
}

/** Side of the room the checkout counter goes to: the one with more floor beside the door (−1 left, +1 right). */
export const counterSide = (f: UnitFrame) => (-f.rx0 >= f.rx1 ? -1 : 1);

/** Checkout counter centre (local) and the side it's on. */
export function counterLayout(f: UnitFrame) {
  const { xl, xr, zf } = roomDims(f);
  const cs = counterSide(f);
  return { cs, ccx: cs < 0 ? xl + 2.6 : xr - 2.6, ccz: zf - 2.4 };
}

/** Brand wall panel at the back of a room (local): width, bottom, top. */
export const brandPanel = (w: number) => ({ pw: Math.min(12, w - 5), y0: 0.9, y1: 4.2 });

/** The podium trio on the free side of the door (opposite the counter), when there's room for it. */
export function podiumLayout(f: UnitFrame) {
  const { xl, xr, zf } = roomDims(f);
  const ps = -counterSide(f);
  const gap = ps < 0 ? -SHOP_DOOR.width / 2 - xl : xr - SHOP_DOOR.width / 2;
  const podX = ps * (SHOP_DOOR.width / 2 + Math.min(gap / 2, 2.6));
  const items = (
    [
      [-0.55, 0.45, 0.95],
      [0.5, 0.42, 0.7],
      [0, 0.38, 0.45],
    ] as const
  ).map(([dx, r, h], i) => ({ x: podX + dx, z: zf - 2.1 - i * 0.55, r, h }));
  return { show: gap > 2.2, podX, items };
}

/** Wall shelving runs along both side walls (local z range). */
export function shelvingRun(f: UnitFrame) {
  const { zf, zb } = roomDims(f);
  return { z0: zf - 4.8, z1: zb + 3.2 };
}

// ───────────────────────────── gondolas ─────────────────────────────

/** Gondola run R2 of supermarket.glb (layout "runs"): copied into the rooms (wing/RentalShops). */
export const GONDOLA_SRC = { minX: 3.6, maxX: 10.25, minY: 0.02, maxY: 2.45, minZ: 0.04, maxZ: 1.23 } as const;
export const GONDOLA_LEN = GONDOLA_SRC.maxX - GONDOLA_SRC.minX;
/** Gondola centre lines (local x offsets from the room's centre): 2.2 m aisles, 2.4 m to the wall shelving. */
export const gondolaOffsets = (roomWidth: number) => (roomWidth >= 16 ? [-5.1, -1.7, 1.7, 5.1] : roomWidth >= 8.5 ? [-2.9, 0, 2.9] : [-1.05, 1.05]);
const GONDOLA_FRONT = 5.5; // free floor between the wall and the gondolas (entrance, counter, podiums)
/** Gondola rows front to back (distance of each row's centre from the wall's outer face), 2 m cross aisle. */
export function gondolaRows(): number[] {
  const rows: number[] = [];
  for (let z = GONDOLA_FRONT; z + GONDOLA_LEN <= SHOP_ROOM.depth - 3; z += GONDOLA_LEN + 2) rows.push(z + GONDOLA_LEN / 2);
  return rows;
}

/**
 * Gondola centres in the local frame (each turned a quarter so it runs front to back), front row first and centre
 * gondolas first within a row.
 */
export function gondolaCenters(f: UnitFrame): { x: number; z: number; row: number }[] {
  const { cx, w } = roomDims(f);
  const offs = [...gondolaOffsets(w)].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  return gondolaRows().flatMap((r, row) => offs.map((o) => ({ x: cx + o, z: -f.t - r, row })));
}

/** One gondola's shelving faces in its own (copied-run) terms, from the store layout (R2S/R2N). */
const GONDOLA = {
  /** Half depth: front edge of each face from the gondola's centre line. */
  half: 0.542,
  /** Bay centres along the run (from its centre) and bay width. */
  bays: [-2.174, 0, 2.174],
  bayWidth: 2.05,
  /** Shelf board tops and the clear height above each. */
  boards: [0.46, 0.94, 1.41, 1.89],
  clearance: 0.42,
} as const;
/** Boards filled first: eye level, then just below, above, bottom. */
const BOARD_ORDER = [2, 1, 3, 0];

export interface ProductSlot {
  /** World position of the slot's centre at the front of the shelf, standing on the board. */
  position: V3;
  /** World yaw so a +z-facing object faces the aisle. */
  yaw: number;
  /** Usable width along the shelf. */
  width: number;
  /** Clear height above the board. */
  height: number;
}

/**
 * Product slots on the gondolas of one shop, best first (front row, centre gondolas, eye level, nearest bay).
 * One slot = one bay of one shelf on one face.
 */
export function productSlots(u: ShopUnit): ProductSlot[] {
  const f = unitFrame(u);
  const out: (ProductSlot & { key: number[] })[] = [];
  for (const [gi, g] of gondolaCenters(f).entries()) {
    for (const side of [-1, 1] as const) {
      for (const [bi, bay] of GONDOLA.bays.entries()) {
        // The run's long axis maps to local −z (quarter turn); the bay nearest the door has the largest local z.
        const lz = g.z - bay;
        for (const [rank, board] of BOARD_ORDER.entries()) {
          const lx = g.x + side * (GONDOLA.half - 0.2);
          const p = toWorld(f, [lx, GONDOLA.boards[board]!, lz]);
          // Local +x facing = yaw +π/2; add the unit's own turn.
          const yaw = f.rotationY + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
          out.push({ position: p, yaw, width: GONDOLA.bayWidth, height: GONDOLA.clearance, key: [g.row, rank, gi, bay === 0 ? 0 : bay > 0 ? 1 : 2, side, bi] });
        }
      }
    }
  }
  out.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!;
    return 0;
  });
  return out.map((s) => ({ position: s.position, yaw: s.yaw, width: s.width, height: s.height }));
}

// ───────────────────────────── collisions (open shops) ─────────────────────────────

/** Width of the walk-through opening of an open shop (the double door; the glass side lites stay closed). */
export const DOOR_GAP = 2.2;
const H = 2;

/** Local axis-aligned box (x0..x1, z0..z1) → world Box (the unit turns by 0 or π, so it stays axis-aligned). */
function worldBox(f: UnitFrame, x0: number, x1: number, z0: number, z1: number): Box {
  const a = toWorld(f, [x0, 0, z0]);
  const b = toWorld(f, [x1, 0, z1]);
  return { min: [Math.min(a[0], b[0]), 0, Math.min(a[2], b[2])], max: [Math.max(a[0], b[0]), H, Math.max(a[2], b[2])] };
}

/** Walk-blocking boxes inside an open shop: its walls (door gap left open) and every fitting. */
export function shopColliders(u: ShopUnit): Box[] {
  const f = unitFrame(u);
  const { xl, xr, cx, w, zf, zb } = roomDims(f);
  const T = 0.15;
  const g = DOOR_GAP / 2;
  const boxes: Box[] = [
    worldBox(f, xl - T, xl, zb - T, zf), // side walls
    worldBox(f, xr, xr + T, zb - T, zf),
    worldBox(f, xl - T, xr + T, zb - T, zb), // back wall
    // Front: the store wall's thickness, except the door opening (covers spots with no store wall, e.g. windows).
    worldBox(f, xl - T, -g, zf, 0),
    worldBox(f, g, xr + T, zf, 0),
  ];
  for (const c of gondolaCenters(f)) boxes.push(worldBox(f, c.x - 0.6, c.x + 0.6, c.z - GONDOLA_LEN / 2, c.z + GONDOLA_LEN / 2));
  const run = shelvingRun(f);
  boxes.push(worldBox(f, xl, xl + 0.5, run.z1, run.z0), worldBox(f, xr - 0.5, xr, run.z1, run.z0));
  const { cs, ccx, ccz } = counterLayout(f);
  boxes.push(worldBox(f, ccx - 1.55, ccx + 1.55, ccz - 0.45, ccz + 0.45));
  boxes.push(cs < 0 ? worldBox(f, xl, xl + 0.6, ccz - 1.1, ccz + 1.5) : worldBox(f, xr - 0.6, xr, ccz - 1.1, ccz + 1.5));
  const pod = podiumLayout(f);
  if (pod.show) for (const p of pod.items) boxes.push(worldBox(f, p.x - p.r, p.x + p.r, p.z - p.r, p.z + p.r));
  const { pw } = brandPanel(w);
  boxes.push(worldBox(f, cx - pw / 2, cx + pw / 2, zb, zb + 1.0));
  if (f.front) boxes.push(worldBox(f, f.front[0], f.front[1], zf - 0.85, zf));
  return boxes;
}

/**
 * The store's wall colliders with an opening cut at each open shop's door: any wall box crossing the doorway (in x,
 * near the wall plane, from the floor) is split into the parts left and right of it.
 */
export function wallsWithDoorGaps(walls: readonly Box[], units: readonly ShopUnit[]): Box[] {
  let out = [...walls];
  for (const u of units) {
    const wall = wallOf(u);
    const zLo = Math.min(wall.inner, wall.outer) - 0.35;
    const zHi = Math.max(wall.inner, wall.outer) + 0.35;
    const g0 = u.x - DOOR_GAP / 2;
    const g1 = u.x + DOOR_GAP / 2;
    out = out.flatMap((b) => {
      const crosses = b.min[0] < g1 && b.max[0] > g0 && b.min[2] < zHi && b.max[2] > zLo && b.min[1] < 1;
      if (!crosses) return [b];
      const parts: Box[] = [];
      if (b.min[0] < g0) parts.push({ min: b.min, max: [g0, b.max[1], b.max[2]] });
      if (b.max[0] > g1) parts.push({ min: [g1, b.min[1], b.min[2]], max: b.max });
      return parts;
    });
  }
  return out;
}
