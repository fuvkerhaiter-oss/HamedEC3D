/**
 * Lucky wheel math + the tiny bridge between input (E key / touch button via actions.ts) and the 3D wheel.
 * Pure module (no three.js), unit-tested. The spin is a just-for-fun draw in the visitor's own browser: it gives no
 * prize and stores nothing.
 */

/** Most segments drawn on the wheel (beyond this the text gets too small to read). */
export const MAX_WHEEL_SEGMENTS = 120;
/** With no names yet, the wheel still shows this many decorative segments. */
export const EMPTY_WHEEL_SEGMENTS = 16;
/**
 * Spinning is switched off for now: the wheel stands behind a rope with a "COMING SOON" sign and can only be looked
 * at. Set to true to let shoppers spin it again (E / touch action button).
 */
export const WHEEL_SPIN_ENABLED = false;

/** Names shown on the wheel: trimmed, non-empty, at most MAX_WHEEL_SEGMENTS. */
export function wheelNames(names: string[]): string[] {
  return names.map((n) => n.trim()).filter(Boolean).slice(0, MAX_WHEEL_SEGMENTS);
}

const TAU = Math.PI * 2;
export const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Segment i spans disc angles [i·seg, (i+1)·seg) counter-clockwise from +x. The pointer is at the top (π/2).
 * With the disc rotated by `rotation` (CCW), the segment under the pointer is the one containing π/2 − rotation.
 */
export function segmentAtPointer(rotation: number, count: number): number {
  const seg = TAU / count;
  return Math.floor(mod(Math.PI / 2 - rotation, TAU) / seg) % count;
}

/**
 * Final rotation for a spin that lands on `winner`: at least `turns` full turns clockwise (negative rotation, like a
 * real wheel pulled down on the right) from `from`, stopping at `jitter` (−0.5..0.5 of a segment, kept away from
 * the dividers) inside the winner's segment.
 */
export function spinTarget(from: number, winner: number, count: number, turns: number, jitter: number): number {
  const seg = TAU / count;
  const j = Math.max(-0.38, Math.min(0.38, jitter));
  const want = Math.PI / 2 - (winner + 0.5 + j) * seg; // rotation that puts that point under the pointer
  const delta = mod(from - want, TAU); // clockwise distance to get there
  return from - delta - turns * TAU;
}

/** Ease-out for the spin (fast start, long soft stop). */
export const easeOutQuart = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

// ── input bridge ──
const listeners = new Set<() => void>();
export function onSpinRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function requestSpin(): void {
  listeners.forEach((fn) => fn());
}
