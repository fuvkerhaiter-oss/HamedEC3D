/**
 * Rental shop units in the main store's side walls: four shop fronts (two in the north wall, two facing them in the
 * south wall), each a door opening cut through the imported wall into a lit, empty shop room behind it. They are
 * closed for now (chained, "FOR RENT"); the store's wall colliders are unchanged, so nobody walks in.
 *
 * Pure data + math (no three.js), shared by env/reshape.ts (cuts the wall faces), wing/RentalShops.tsx and tests.
 */

export type WallSide = "N" | "S";

/** One face of an imported side wall that is rebuilt with door holes (inner = faces the store). */
export interface WallFace {
  side: WallSide;
  /** Plane of the face. */
  z: number;
  inner: boolean;
  /** Extent of the imported triangles that are replaced (the rebuilt face covers exactly this). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Wall planes of supermarket.glb (Material.014, double-sided plaster). */
export const SIDE_WALL = {
  N: { inner: 8.072, outer: 8.74 },
  S: { inner: -6.77, outer: -7.44 },
} as const;
/** The new hall's side walls (wing/NewWing: one plaster plane each, 0.3 m collider behind it). */
export const HALL_WALL = {
  N: { inner: 8.072, outer: 8.372 },
  S: { inner: -6.672, outer: -6.972 },
} as const;
/** The hall walls start here (the old far wall's place). */
export const HALL_X0 = 14.125;

/**
 * Faces rebuilt with holes: the whole north wall is one quad per face; the south wall is split by the store's windows
 * and entrance, so only its plain section east of the windows (x 7.47 → 15.02) is replaced.
 */
export const WALL_FACES: WallFace[] = [
  { side: "N", z: SIDE_WALL.N.inner, inner: true, x0: -12.92, x1: 15.02, y0: -0.04, y1: 6.07 },
  { side: "N", z: SIDE_WALL.N.outer, inner: false, x0: -12.92, x1: 15.02, y0: -0.04, y1: 6.07 },
  { side: "S", z: SIDE_WALL.S.inner, inner: true, x0: 7.47, x1: 15.02, y0: -0.04, y1: 6.07 },
  { side: "S", z: SIDE_WALL.S.outer, inner: false, x0: 7.47, x1: 15.02, y0: -0.04, y1: 6.07 },
];

/** Door opening in the wall (the storefront fills it). */
export const SHOP_DOOR = { width: 3.6, height: 4.0 } as const;
/** Shop room behind the wall: depth from the wall's outer face, inside height. */
export const SHOP_ROOM = { width: 18, depth: 24, height: 5.0 } as const;

export interface ShopUnit {
  id: string;
  /** Shown on the fascia ("SHOP 01"). */
  label: string;
  side: WallSide;
  /** In the imported store's side wall, or in the new hall's side wall. */
  wall: "main" | "hall";
  /** Centre of the door opening. */
  x: number;
  /** Room extent along x (rooms can be wider than their door; neighbours share a partition). */
  roomX0: number;
  roomX1: number;
  /** World x span of the room's front with no store wall in front of it (behind windows): closed by its own wall. */
  frontWall?: [number, number];
}

/**
 * Every room is SHOP_ROOM.width (18 m) wide and SHOP_ROOM.depth (24 m) deep; neighbours on one wall share a
 * partition, so a room is not always centred on its door (doors stay where the store's walls are free).
 * North: two doors in the store's north wall (free plaster from x ≈ −0.4 to 14.1 since the freezer went); the second
 * room runs on behind the new hall's north wall. South: the store's south wall only has x 7.47 (structural pillar) →
 * 14.1 free, so one door there and the second in the new hall's south wall, past the lucky wheel and short of the gate
 * pillar. Shop 03's room reaches behind the south windows: that stretch gets its own front wall (`frontWall`).
 */
export const SHOP_UNITS: ShopUnit[] = [
  { id: "shop-1", label: "SHOP 01", side: "N", wall: "main", x: 3.0, roomX0: -8.6, roomX1: 9.4 },
  { id: "shop-2", label: "SHOP 02", side: "N", wall: "main", x: 12.0, roomX0: 9.4, roomX1: 27.4 },
  { id: "shop-3", label: "SHOP 03", side: "S", wall: "main", x: 10.7, roomX0: 1.0, roomX1: 19.0, frontWall: [1.0, 7.47] },
  { id: "shop-4", label: "SHOP 04", side: "S", wall: "hall", x: 22.0, roomX0: 19.0, roomX1: 37.0 },
];

/** Door holes cut into the faces of one side wall (store or hall): [x0, x1, y0, y1]. */
export function doorHoles(side: WallSide, wall: "main" | "hall" = "main"): [number, number, number, number][] {
  return SHOP_UNITS.filter((u) => u.side === side && u.wall === wall).map((u) => [u.x - SHOP_DOOR.width / 2, u.x + SHOP_DOOR.width / 2, 0, SHOP_DOOR.height]);
}

/** Inner/outer wall plane of a unit's wall. */
export const wallOf = (u: ShopUnit) => (u.wall === "hall" ? HALL_WALL : SIDE_WALL)[u.side];

/** Direction from the wall into the store (+1 = +z). */
export const intoStore = (side: WallSide) => (side === "N" ? -1 : 1);

/**
 * The imported wall face a triangle belongs to (all three vertices on the face plane and inside its x extent), or
 * null. Only plaster triangles (Material.014) are ever passed in.
 */
export function wallFaceOf(verts: [number, number, number][]): WallFace | null {
  for (const f of WALL_FACES) {
    if (verts.every(([x, , z]) => Math.abs(z - f.z) < 0.02 && x >= f.x0 - 0.02 && x <= f.x1 + 0.02)) return f;
  }
  return null;
}
