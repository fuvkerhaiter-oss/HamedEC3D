/**
 * Pure geometry for the store minimap: world (x, z) ↔ map pixels, and aisle labels from the layout's aisle signs.
 * A true top-down view (seen from above, not mirrored): +x to the right (entrance → new hall → coming-soon wing),
 * +z downwards. (Drawing +z upwards with +x to the right would mirror the store: left and right swapped.)
 */
import type { Sign } from "../layout";

/** World area shown (m): the whole store + new hall + wing, with room for labels outside the side walls. */
export const MAP_BOUNDS = { minX: -13.6, maxX: 34.9, minZ: -9.0, maxZ: 10.4 } as const;

export interface MapFrame {
  /** Pixels per metre. */
  s: number;
  width: number;
  height: number;
  px: (x: number) => number;
  py: (z: number) => number;
}

export function mapFrame(width: number): MapFrame {
  const b = MAP_BOUNDS;
  const s = width / (b.maxX - b.minX);
  return {
    s,
    width,
    height: Math.round((b.maxZ - b.minZ) * s),
    px: (x) => (x - b.minX) * s,
    py: (z) => (z - b.minZ) * s,
  };
}

/** Heading of the player on the map: angle (radians, canvas convention, 0 = right, +y down) of forward. */
export function mapHeading(yaw: number): number {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return Math.atan2(fz, fx); // world +z is map down (+y)
}

/** Rotation that turns the map so the player's heading points up (heading-up minimap). */
export const headingUpRotation = (heading: number) => -Math.PI / 2 - heading;

export interface AisleLabel {
  text: string;
  x: number;
  z: number;
}

/** One label per aisle: the signs come in pairs (both ends of a run) with the same text and z. */
export function aisleLabels(signs: Sign[]): AisleLabel[] {
  const groups = new Map<string, { text: string; xs: number[]; z: number }>();
  for (const s of signs) {
    const key = `${s.text}|${s.position[2].toFixed(1)}`;
    const g = groups.get(key) ?? { text: s.text, xs: [], z: s.position[2] };
    g.xs.push(s.position[0]);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ text: g.text, x: g.xs.reduce((a, b) => a + b, 0) / g.xs.length, z: g.z }));
}
