/**
 * Christmas decoration of the big store (wing/../xmas/ChristmasDecor renders it): a tree plaza in the new hall
 * (stylised tree on a snowy base with presents, Santa's sleigh, Santa, a snowman), a snowman greeting shoppers at the
 * entrance, wreaths on the gondola end caps, string lights over every aisle and across the hall, bunting on the walls,
 * stockings on the checkout, giant ornaments hanging from the ceiling, a "Merry Christmas" banner and falling snow.
 *
 * Seasonal: on from 15 Nov to 7 Jan (local date), or forced with NEXT_PUBLIC_CHRISTMAS=on|off.
 * Pure data + math (no three.js), shared by the renderer, the collision setup (extension.ts) and unit tests.
 * Models: public/models/xmas/*.opt.glb (sources in christmas/, see ASSET_INVENTORY.md).
 */
import type { Box } from "./types";

export function isChristmasSeason(date: Date, override?: string): boolean {
  if (override === "on") return true;
  if (override === "off") return false;
  const m = date.getMonth();
  const d = date.getDate();
  return (m === 10 && d >= 15) || m === 11 || (m === 0 && d <= 7);
}

/** Decided once per page load. */
export const CHRISTMAS_ON = isChristmasSeason(new Date(), process.env.NEXT_PUBLIC_CHRISTMAS);

/** A floor prop: centre x/z, yaw (radians about +Y; 0 = the model's own front), collider half-size. */
export interface XmasProp {
  x: number;
  z: number;
  yaw: number;
  half: [number, number];
}

/**
 * Tree plaza against the south wall where the store opens into the new hall, between SHOP 03's door and the sleigh
 * (moved here on the owner's request, 2026-11-27); the hall stays open on its north side.
 */
export const XMAS_TREE = { x: 15.0, z: -4.2, height: 3.5, radius: 2.2 } as const;
export const XMAS_SLEIGH: XmasProp = { x: 18.8, z: -5.3, yaw: -Math.PI / 2, half: [0.9, 1.35] };
/** Beside the sleigh's front, facing shoppers coming from the store and the hall (moved on the owner's request). */
export const XMAS_SANTA: XmasProp = { x: 18.1, z: -3.4, yaw: -Math.PI / 2 + 0.5, half: [0.55, 0.55] };
export const XMAS_SNOWMEN: XmasProp[] = [
  { x: 14.55, z: 6.0, yaw: -Math.PI / 2 - 0.5, half: [0.5, 0.5] },
  // Entrance lobby, turned toward the shopper who just walked in.
  { x: -7.75, z: -4.9, yaw: -0.35, half: [0.5, 0.5] },
];

/** Walk-blocking boxes (added to the store walls while the decoration is on). */
export function christmasColliders(): Box[] {
  const t = XMAS_TREE;
  const prop = (p: XmasProp): Box => {
    // Axis-aligned bounds of the rotated footprint.
    const c = Math.abs(Math.cos(p.yaw));
    const s = Math.abs(Math.sin(p.yaw));
    const hx = p.half[0] * c + p.half[1] * s;
    const hz = p.half[0] * s + p.half[1] * c;
    return { min: [p.x - hx, 0, p.z - hz], max: [p.x + hx, 1.8, p.z + hz] };
  };
  return [
    { min: [t.x - t.radius, 0, t.z - t.radius], max: [t.x + t.radius, 3, t.z + t.radius] },
    prop(XMAS_SLEIGH),
    prop(XMAS_SANTA),
    ...XMAS_SNOWMEN.map(prop),
  ];
}

/** Gondola end caps (store x of the cap face, run centre z): a wreath stands on top of each, facing out. */
export const XMAS_END_CAPS = {
  faces: [
    { x: -6.72, dir: -1 },
    { x: 1.02, dir: 1 },
    { x: 3.08, dir: -1 },
    { x: 10.82, dir: 1 },
  ],
  z: [-3.2, 0.65, 4.2],
  top: 2.42,
} as const;

/** String-light spans: from (x0,z0) to (x1,z1) at hook height y (the string sags ~1 m below it). */
export interface LightSpan {
  from: [number, number];
  to: [number, number];
  y: number;
}
const AISLES_Z = [-5.0, -1.3, 2.45, 5.95];
export const XMAS_LIGHT_SPANS: LightSpan[] = [
  // Over every aisle, both halves of the store.
  ...AISLES_Z.flatMap((z) => [
    { from: [-6.4, z] as [number, number], to: [0.6, z] as [number, number], y: 4.5 },
    { from: [3.4, z] as [number, number], to: [10.4, z] as [number, number], y: 4.5 },
  ]),
  // Across the cross aisle and the lobby.
  { from: [-12.3, -1.3], to: [-6.9, -1.3], y: 4.5 },
  // Across the new hall, wall to wall in two swags.
  ...[15.2, 22.8].flatMap((x) => [
    { from: [x, -6.5] as [number, number], to: [x, 0.7] as [number, number], y: 5.4 },
    { from: [x, 0.7] as [number, number], to: [x, 7.9] as [number, number], y: 5.4 },
  ]),
];

/** Giant ornaments hanging from the ceiling (x, z, hang height of the ornament's top). */
export const XMAS_ORNAMENTS: [number, number, number][] = [
  [-9.6, -3.6, 4.1],
  [-9.0, 1.2, 3.8],
  [2.05, -4.5, 4.0],
  [2.05, 2.4, 4.0],
  [2.05, 5.6, 3.8],
  [12.4, -2.0, 3.9],
  [12.4, 2.6, 3.6],
];

/** "Merry Christmas" banner over the cross aisle, framed by the entrance aisle (faces −X, toward the spawn). */
export const XMAS_BANNER = { x: 2.05, y: 3.6, z: -1.3 } as const;

/** Wreaths hung on walls: x, y (bottom), z, yaw (0 = facing +Z). Above the entrance door, inside. */
export const XMAS_WALL_WREATHS: [number, number, number, number][] = [[-9.95, 3.05, -6.66, 0]];
