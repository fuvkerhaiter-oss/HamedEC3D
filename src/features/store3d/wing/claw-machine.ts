/**
 * Prize claw game logic + the tiny bridge between input (E key / touch button via actions.ts) and the 3D cabinet
 * (wing/PrizeClawMachine.tsx). Pure module (no three.js), unit-tested.
 *
 * Just for fun, in the visitor's own browser: free to play, nothing is won for real, nothing is stored.
 *
 * Play: press once to start (the claw sweeps left ↔ right), press to lock X (it sweeps front ↔ back), press to lock
 * Z and the claw drops, grabs, lifts and carries whatever it holds to the chute. Like a real machine, a grip far
 * from a prize's centre often slips.
 */
import { create } from "zustand";

export type ClawPhase = "idle" | "aimX" | "aimZ" | "drop" | "grab" | "lift" | "carry" | "release" | "home";

/** Claw travel inside the glass (local metres, cabinet centre = 0). */
export const CLAW_LIMIT_X = 0.5;
export const CLAW_LIMIT_Z = 0.44;
/** Prize chute (front-right corner seen from +z): where prizes are dropped and where the claw parks. */
export const CHUTE = { x: 0.43, z: 0.36, half: 0.15 } as const;
/** A grab further than this from a prize's centre misses it entirely. */
export const GRAB_RADIUS = 0.15;
/** Seconds a sweep runs before the machine locks the axis by itself. */
export const AIM_TIMEOUT = 8;

export const clawPhaseLabel: Record<ClawPhase, string> = {
  idle: "Play the prize claw (free)",
  aimX: "Stop the claw ←→",
  aimZ: "Stop the claw ↑↓ and drop",
  drop: "Dropping…",
  grab: "Grabbing…",
  lift: "Lifting…",
  carry: "Carrying to the chute…",
  release: "Releasing…",
  home: "Resetting…",
};

/** Triangle wave between −limit and +limit, starting at `start` going toward −limit. */
export function sweep(t: number, speed: number, limit: number, start: number): number {
  const span = 2 * limit;
  // phase offset so that sweep(0) = start while moving toward −limit
  const p0 = limit - Math.max(-limit, Math.min(limit, start));
  const d = (((p0 + t * speed) % (2 * span)) + 2 * span) % (2 * span);
  return d <= span ? limit - d : -limit + (d - span);
}

export interface PrizeSpot {
  x: number;
  z: number;
}

/** Index of the prize nearest to (x, z) within GRAB_RADIUS (ignoring unavailable ones), or −1. */
export function nearestPrize(prizes: readonly PrizeSpot[], available: readonly boolean[], x: number, z: number): number {
  let best = -1;
  let bestD = GRAB_RADIUS;
  prizes.forEach((p, i) => {
    if (!available[i]) return;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Chance the claw keeps hold of a prize gripped `dist` metres off-centre: ~80 % dead centre, ~10 % at the edge. */
export function gripChance(dist: number): number {
  const k = Math.max(0, Math.min(1, dist / GRAB_RADIUS));
  return 0.8 - 0.7 * k * k;
}

export const easeInOut = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};

// ── HUD state ──
export const useClawGame = create<{ phase: ClawPhase; setPhase: (p: ClawPhase) => void }>((set) => ({
  phase: "idle",
  setPhase: (phase) => set({ phase }),
}));

// ── input bridge ──
const listeners = new Set<() => void>();
export function onClawPress(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function pressClaw(): void {
  listeners.forEach((fn) => fn());
}
