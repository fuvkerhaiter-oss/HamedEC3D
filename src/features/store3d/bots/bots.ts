/**
 * Bot shoppers (pure, no three.js / React): 5 clearly labelled demo bots that push trolleys around the store
 * so it doesn't feel empty. They plan paths on a coarse walkable grid built from the same colliders the
 * shopper uses, and every move goes through the shared top-down solver (../collision), so they never pass
 * through shelves, fridges, pillars or the chained wing.
 *
 * Bots are purely cosmetic: no carts, orders, stock, prices or network traffic. Gated by `botsEnabled()`.
 * Per-frame work (`stepBots`) allocates nothing; paths are (re)planned only when a bot picks a new goal.
 */
import { resolve, step, type Motion, type Rect, type ShopperShape } from "../collision";
import { GATE_X } from "../env/extension";
import type { EnvLayout } from "../env/types";
import { TROLLEY } from "../trolley/geometry";

export const BOT_COUNT = 5;

/**
 * Switch: NEXT_PUBLIC_STORE_BOTS = "on"/"1"/"true" forces bots on, "off"/"0"/"false" forces them off;
 * unset → on in development only (production unaffected unless the owner turns it on).
 */
export function botsEnabled(flag: string | undefined, nodeEnv: string | undefined): boolean {
  const f = (flag ?? "").trim().toLowerCase();
  if (["1", "on", "true", "yes"].includes(f)) return true;
  if (["0", "off", "false", "no"].includes(f)) return false;
  return nodeEnv === "development";
}

/** Same body + trolley footprint as the real shopper (Player.tsx). */
export const BOT_SHAPE: ShopperShape = {
  radius: 0.3,
  box: { offsetX: TROLLEY.collider.center[0], offsetZ: TROLLEY.collider.center[2], halfX: TROLLEY.collider.halfExtents[0], halfZ: TROLLEY.collider.halfExtents[2] },
};

export interface Persona {
  name: string; // shown as "Bot · <name>"
  color: string;
  speed: number; // m/s cruising
  wobble: number; // 0..1 how drunkenly they waddle
  trick: Trick; // favourite silly move
  /** Chance per second of breaking into a run while walking (0 = never runs). */
  dash: number;
}

export type Trick = "spin" | "hop" | "dance" | "wobble";

export const PERSONAS: readonly Persona[] = [
  { name: "Lulu", color: "#ff7eb6", speed: 1.25, wobble: 0.5, trick: "spin", dash: 0.12 },
  { name: "Bobo", color: "#4fb3ff", speed: 1.05, wobble: 1, trick: "wobble", dash: 0.06 },
  { name: "Pip", color: "#ffd23f", speed: 1.7, wobble: 0.25, trick: "hop", dash: 0.35 }, // the sprinter
  { name: "Zaza", color: "#8be37a", speed: 1.15, wobble: 0.4, trick: "dance", dash: 0 },
  { name: "Momo", color: "#b48cff", speed: 0.95, wobble: 0.7, trick: "spin", dash: 0 },
];

export const botLabel = (p: Persona) => `Bot · ${p.name}`;

// ---------------------------------------------------------------------------------------------------------
// Random numbers (seeded so tests and replays are deterministic).

/** mulberry32: small fast seeded PRNG returning [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------
// Walkable grid.

export interface NavGrid {
  minX: number;
  minZ: number;
  cell: number;
  cols: number;
  rows: number;
  /** 1 = walkable and reachable from the seed point. */
  free: Uint8Array;
}

export const cellIndex = (g: NavGrid, c: number, r: number) => r * g.cols + c;
export const cellCenter = (g: NavGrid, c: number, r: number): [number, number] => [g.minX + (c + 0.5) * g.cell, g.minZ + (r + 0.5) * g.cell];
export function cellOf(g: NavGrid, x: number, z: number): [number, number] {
  return [Math.floor((x - g.minX) / g.cell), Math.floor((z - g.minZ) / g.cell)];
}
export function isFree(g: NavGrid, x: number, z: number): boolean {
  const [c, r] = cellOf(g, x, z);
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.free[cellIndex(g, c, r)] === 1;
}

/** Distance from point to rect (0 inside). */
function rectDist(x: number, z: number, b: Rect): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * Cells whose centre is at least `clearance` from every obstacle, then flood-filled from `seed` so bots only
 * ever aim at places they can actually reach (not behind the chains or inside the back rooms).
 */
export function buildNavGrid(bounds: Rect, rects: readonly Rect[], seed: [number, number], cell = 0.35, clearance = 0.6): NavGrid {
  const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell);
  const g: NavGrid = { minX: bounds.minX, minZ: bounds.minZ, cell, cols, rows, free: new Uint8Array(cols * rows) };
  const open = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x, z] = cellCenter(g, c, r);
      let ok = x - bounds.minX >= clearance && bounds.maxX - x >= clearance && z - bounds.minZ >= clearance && bounds.maxZ - z >= clearance;
      for (let i = 0; ok && i < rects.length; i++) if (rectDist(x, z, rects[i]!) < clearance) ok = false;
      if (ok) open[cellIndex(g, c, r)] = 1;
    }
  }
  const [sc, sr] = cellOf(g, seed[0], seed[1]);
  if (sc < 0 || sr < 0 || sc >= cols || sr >= rows || !open[cellIndex(g, sc, sr)]) return g;
  const stack = [cellIndex(g, sc, sr)];
  g.free[stack[0]!] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % cols, r = (i - c) / cols;
    for (const [dc, dr] of N4) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = cellIndex(g, nc, nr);
      if (open[j] && !g.free[j]) {
        g.free[j] = 1;
        stack.push(j);
      }
    }
  }
  return g;
}

const N4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Straight segment stays on free cells (sampled every half cell). */
export function lineFree(g: NavGrid, ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (g.cell * 0.5)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!isFree(g, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}

/** A* over free cells (8-connected, no corner cutting), then string-pulled to a few waypoints. Null = no path. */
export function findPath(g: NavGrid, from: [number, number], to: [number, number]): [number, number][] | null {
  const [sc, sr] = cellOf(g, from[0], from[1]);
  const [tc, tr] = cellOf(g, to[0], to[1]);
  const inGrid = (c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows;
  if (!inGrid(tc, tr) || !g.free[cellIndex(g, tc, tr)]) return null;
  // The bot may stand slightly off the grid (pushed by a bump): start from the nearest free cell.
  const s = inGrid(sc, sr) && g.free[cellIndex(g, sc, sr)] ? cellIndex(g, sc, sr) : nearestFree(g, sc, sr);
  if (s < 0) return null;
  const goal = cellIndex(g, tc, tr);
  const n = g.cols * g.rows;
  const gScore = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (i: number) => {
    const c = i % g.cols, r = (i - c) / g.cols;
    const dx = Math.abs(c - tc), dz = Math.abs(r - tr);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  // Binary heap of [f, index].
  const heap: number[] = [];
  const push = (f: number, i: number) => {
    heap.push(f, i);
    let k = heap.length / 2 - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p * 2]! <= heap[k * 2]!) break;
      [heap[p * 2], heap[k * 2]] = [heap[k * 2]!, heap[p * 2]!];
      [heap[p * 2 + 1], heap[k * 2 + 1]] = [heap[k * 2 + 1]!, heap[p * 2 + 1]!];
      k = p;
    }
  };
  const pop = () => {
    const i = heap[1]!;
    const lastF = heap[heap.length - 2]!, lastI = heap[heap.length - 1]!;
    heap.length -= 2;
    if (heap.length) {
      heap[0] = lastF;
      heap[1] = lastI;
      let k = 0;
      const m = heap.length / 2;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let b = k;
        if (l < m && heap[l * 2]! < heap[b * 2]!) b = l;
        if (r < m && heap[r * 2]! < heap[b * 2]!) b = r;
        if (b === k) break;
        [heap[b * 2], heap[k * 2]] = [heap[k * 2]!, heap[b * 2]!];
        [heap[b * 2 + 1], heap[k * 2 + 1]] = [heap[k * 2 + 1]!, heap[b * 2 + 1]!];
        k = b;
      }
    }
    return i;
  };
  gScore[s] = 0;
  push(h(s), s);
  while (heap.length) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    const c = i % g.cols, r = (i - c) / g.cols;
    for (const [dc, dr, cost] of N8) {
      const nc = c + dc, nr = r + dr;
      if (!inGrid(nc, nr)) continue;
      const j = cellIndex(g, nc, nr);
      if (!g.free[j] || closed[j]) continue;
      if (dc && dr && (!g.free[cellIndex(g, c + dc, r)] || !g.free[cellIndex(g, c, r + dr)])) continue;
      const ng = gScore[i]! + cost;
      if (ng < gScore[j]!) {
        gScore[j] = ng;
        came[j] = i;
        push(ng + h(j), j);
      }
    }
  }
  if (!closed[goal]) return null;
  const cells: [number, number][] = [];
  for (let i = goal; i !== -1; i = came[i]!) {
    const c = i % g.cols;
    cells.push(cellCenter(g, c, (i - c) / g.cols));
    if (i === s) break;
  }
  cells.reverse();
  cells[cells.length - 1] = [to[0], to[1]];
  // String pulling: keep only the turns.
  const out: [number, number][] = [];
  let a = cells[0]!;
  for (let k = 2; k < cells.length; k++) {
    if (!lineFree(g, a[0], a[1], cells[k]![0], cells[k]![1])) {
      a = cells[k - 1]!;
      out.push(a);
    }
  }
  out.push(cells[cells.length - 1]!);
  return out;
}

function nearestFree(g: NavGrid, c0: number, r0: number): number {
  for (let rad = 1; rad < 6; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
        const i = cellIndex(g, c, r);
        if (g.free[i]) return i;
      }
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------------------
// World: grid + interesting spots.

export interface Spot {
  x: number;
  z: number;
  /** World yaw the bot's body turns to (shelf to look at / the chains to dance at). */
  faceYaw: number;
}

export interface BotWorld {
  grid: NavGrid;
  rects: readonly Rect[];
  /** In an aisle next to a gondola: stop and stare at the products. */
  shelfSpots: Spot[];
  /** In front of the chained "COMING SOON" wing: party. */
  danceSpots: Spot[];
}

/** Yaw (Three.js, front = −Z) that faces world direction (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Bot world from the shopper's colliders. `extra` are bot-only no-go zones (the floating updates board in
 * front of the chains, which has no collider because it only opens for the real shopper).
 */
export function buildBotWorld(env: EnvLayout, rects: readonly Rect[], seed: [number, number]): BotWorld {
  const { min, max } = env.interior;
  const z0 = min[2], z1 = max[2];
  const boardZone: Rect = { minX: GATE_X - 3.9, maxX: GATE_X + 0.2, minZ: z0, maxZ: z1 };
  const all = [...rects, boardZone];
  const grid = buildNavGrid({ minX: min[0], maxX: max[0], minZ: z0, maxZ: z1 }, all, seed);
  const shelfSpots: Spot[] = [];
  for (const run of env.runs) {
    for (const side of [-1, 1]) {
      const z = side < 0 ? run.box.min[2] - 1.15 : run.box.max[2] + 1.15;
      for (let x = run.box.min[0] + 0.8; x <= run.box.max[0] - 0.8; x += 1.6) {
        if (isFree(grid, x, z)) shelfSpots.push({ x, z, faceYaw: yawOf(0, -side) });
      }
    }
  }
  const danceSpots: Spot[] = [];
  const dx = boardZone.minX - 1.7; // trolley front stays clear of the board zone
  for (let z = z0 + 1.5; z <= z1 - 1.5; z += 1.5) if (isFree(grid, dx, z)) danceSpots.push({ x: dx, z, faceYaw: yawOf(1, 0) });
  return { grid, rects: all, shelfSpots, danceSpots };
}

// ---------------------------------------------------------------------------------------------------------
// Bot state + simulation.

export type BotMode = "walk" | "look" | "spin" | "hop" | "dance" | "oops" | "wait";

export interface Bot {
  persona: Persona;
  motion: Motion;
  yaw: number; // trolley / feet heading
  mode: BotMode;
  modeT: number; // seconds in the current mode
  modeLen: number; // how long the current (non-walk) mode lasts
  path: [number, number][];
  wp: number; // next waypoint index
  goal: Spot | null;
  goalKind: "roam" | "shelf" | "dance";
  stuckT: number; // seconds without progress while walking
  lastX: number;
  lastZ: number;
  bumpCooldown: number;
  walkT: number; // accumulates while moving (drives the waddle)
  sprintT: number; // seconds of running left (0 = walking)
  sprintAge: number; // seconds since this run started
  rand: () => number;
}

export function createBots(world: BotWorld, seed = 7): Bot[] {
  const r = rng(seed);
  const bots: Bot[] = [];
  const pool = [...world.shelfSpots];
  for (let i = 0; i < BOT_COUNT; i++) {
    // Start spread out at shelf spots (or any free cell), at least 3 m apart.
    let sx = 0, sz = 0;
    for (let tries = 0; tries < 200; tries++) {
      const s = pool.length && tries < 100 ? pool[Math.floor(r() * pool.length)]! : randomFree(world.grid, r);
      if (!s) continue;
      if (bots.every((b) => Math.hypot(b.motion.x - s.x, b.motion.z - s.z) > 3)) {
        sx = s.x;
        sz = s.z;
        break;
      }
    }
    const persona = PERSONAS[i % PERSONAS.length]!;
    bots.push({
      persona,
      motion: { x: sx, z: sz, vx: 0, vz: 0 },
      yaw: r() * Math.PI * 2 - Math.PI,
      mode: "wait",
      modeT: 0,
      modeLen: 0.3 + r() * 1.5,
      path: [],
      wp: 0,
      goal: null,
      goalKind: "roam",
      stuckT: 0,
      lastX: sx,
      lastZ: sz,
      bumpCooldown: 0,
      walkT: r() * 10,
      sprintT: 0,
      sprintAge: 0,
      rand: rng(seed * 31 + i * 977 + 1),
    });
  }
  return bots;
}

function randomFree(g: NavGrid, r: () => number): Spot | null {
  for (let i = 0; i < 400; i++) {
    const c = Math.floor(r() * g.cols), rr = Math.floor(r() * g.rows);
    if (g.free[cellIndex(g, c, rr)]) {
      const [x, z] = cellCenter(g, c, rr);
      return { x, z, faceYaw: 0 };
    }
  }
  return null;
}

/** Pick the next goal and plan a path to it. */
export function chooseGoal(bot: Bot, world: BotWorld): void {
  const r = bot.rand();
  const dancer = bot.persona.trick === "dance";
  let kind: Bot["goalKind"];
  let spot: Spot | null;
  if (world.danceSpots.length && r < (dancer ? 0.4 : 0.14)) {
    kind = "dance";
    spot = world.danceSpots[Math.floor(bot.rand() * world.danceSpots.length)]!;
  } else if (world.shelfSpots.length && r < 0.75) {
    kind = "shelf";
    spot = world.shelfSpots[Math.floor(bot.rand() * world.shelfSpots.length)]!;
  } else {
    kind = "roam";
    spot = randomFree(world.grid, bot.rand);
  }
  const path = spot ? findPath(world.grid, [bot.motion.x, bot.motion.z], [spot.x, spot.z]) : null;
  if (!spot || !path) {
    setMode(bot, "wait", 0.5 + bot.rand());
    return;
  }
  bot.goal = spot;
  bot.goalKind = kind;
  bot.path = path;
  bot.wp = 0;
  bot.stuckT = 0;
  setMode(bot, "walk", 0);
}

function setMode(bot: Bot, mode: BotMode, len: number) {
  bot.mode = mode;
  bot.modeT = 0;
  bot.modeLen = len;
}

const ARRIVE = 0.45; // m from a waypoint
const TURN_RATE = 2.6; // rad/s the trolley swings
/** Running: speed × this (Pip tops out near the real shopper's run speed of 3.8 m/s). */
export const SPRINT_FACTOR = 2.2;
const BUMP_DIST = 1.05; // between bump centres (body + half the trolley)
const BUMP_FWD = 0.55; // bump centre sits this far in front of the body

/** The real shopper (camera) on the floor, so bots don't walk through them. */
export interface PlayerSpot {
  x: number;
  z: number;
  active: boolean;
}

/** Advance every bot by `dt` seconds (call once per frame for all bots). Allocation-free except path replans. */
export function stepBots(bots: Bot[], world: BotWorld, dt: number, player?: PlayerSpot): void {
  const h = Math.min(dt, 0.1);
  for (const b of bots) stepBot(b, world, h);
  separate(bots, world, player);
}

function stepBot(b: Bot, world: BotWorld, dt: number): void {
  b.modeT += dt;
  b.bumpCooldown = Math.max(0, b.bumpCooldown - dt);
  const m = b.motion;
  if (b.mode !== "walk") {
    m.vx = 0;
    m.vz = 0;
    step(m, b.yaw, b.yaw, dt, BOT_SHAPE, world.rects); // stay resolved (another bot may have nudged us)
    if (b.modeT >= b.modeLen) afterMode(b, world);
    return;
  }
  const wp = b.path[b.wp];
  if (!wp) {
    arrive(b, world);
    return;
  }
  const dx = wp[0] - m.x, dz = wp[1] - m.z;
  const d = Math.hypot(dx, dz);
  const running = b.sprintT > 0;
  if (d < (running ? ARRIVE + 0.3 : ARRIVE)) {
    b.wp++;
    return;
  }
  const want = yawOf(dx, dz);
  const turn = wrap(want - b.yaw);
  const maxTurn = TURN_RATE * (running ? 1.6 : 1) * dt;
  const newYaw = b.yaw + Math.max(-maxTurn, Math.min(maxTurn, turn));
  // Slow down for sharp turns (pushing a trolley round a corner) and when close to the final goal.
  const sharp = Math.max(0.15, Math.cos(Math.min(Math.abs(turn), Math.PI / 2)));
  const last = b.wp === b.path.length - 1;
  const speed = b.persona.speed * (running ? SPRINT_FACTOR : 1) * sharp * (last ? Math.min(1, 0.3 + d / (running ? 3 : 1.5)) : 1);
  m.vx = -Math.sin(newYaw) * speed;
  m.vz = -Math.cos(newYaw) * speed;
  step(m, b.yaw, newYaw, dt, BOT_SHAPE, world.rects);
  b.yaw = wrap(newYaw);
  b.walkT += dt * speed;
  // Runs: a few seconds of full speed ahead, then back to strolling.
  if (running) {
    b.sprintT = Math.max(0, b.sprintT - dt);
    b.sprintAge += dt;
  } else if (b.persona.dash > 0 && b.rand() < dt * b.persona.dash) {
    b.sprintT = 2 + b.rand() * 3;
    b.sprintAge = 0;
  }
  // Little random silliness while walking.
  if (running) {
    // no hops mid-run
  } else if (b.rand() < dt * 0.06) setMode(b, "hop", 0.9);
  else if (b.persona.trick === "spin" && b.rand() < dt * 0.04) setMode(b, "spin", 1.3);
  // Stuck (pushed around by a bump, trolley caught on a corner): pick something else.
  b.stuckT += dt;
  if (b.stuckT > 1.2) {
    const moved = Math.hypot(m.x - b.lastX, m.z - b.lastZ);
    b.lastX = m.x;
    b.lastZ = m.z;
    b.stuckT = 0;
    if (moved < 0.25) chooseGoal(b, world);
  }
}

function arrive(b: Bot, world: BotWorld) {
  if (b.goalKind === "dance") setMode(b, "dance", 5 + b.rand() * 4);
  else if (b.goalKind === "shelf") setMode(b, "look", 2 + b.rand() * 2.5);
  else {
    const r = b.rand();
    const t = b.persona.trick;
    if (r < 0.4) setMode(b, t === "hop" ? "hop" : t === "dance" ? "dance" : "spin", t === "dance" ? 3 : t === "hop" ? 1.8 : 1.4);
    else if (r < 0.7) setMode(b, "spin", 1.4);
    else chooseGoal(b, world);
  }
}

function afterMode(b: Bot, world: BotWorld) {
  if (b.mode === "oops" || b.mode === "hop" || b.mode === "spin") {
    // Resume the walk if there was one, else find something new.
    if (b.path[b.wp] && b.goal) {
      setMode(b, "walk", 0);
      b.lastX = b.motion.x;
      b.lastZ = b.motion.z;
      b.stuckT = 0;
      return;
    }
  }
  chooseGoal(b, world);
}

function separate(bots: Bot[], world: BotWorld, player?: PlayerSpot) {
  for (let i = 0; i < bots.length; i++) {
    const a = bots[i]!;
    const ax = a.motion.x - Math.sin(a.yaw) * BUMP_FWD, az = a.motion.z - Math.cos(a.yaw) * BUMP_FWD;
    for (let j = i + 1; j < bots.length; j++) {
      const b = bots[j]!;
      const bx = b.motion.x - Math.sin(b.yaw) * BUMP_FWD, bz = b.motion.z - Math.cos(b.yaw) * BUMP_FWD;
      const dx = bx - ax, dz = bz - az;
      const d = Math.hypot(dx, dz);
      if (d >= BUMP_DIST) continue;
      const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
      const push = (BUMP_DIST - d) / 2;
      a.motion.x -= nx * push;
      a.motion.z -= nz * push;
      b.motion.x += nx * push;
      b.motion.z += nz * push;
      bump(a);
      bump(b);
      resolve(a.motion, a.yaw, BOT_SHAPE, world.rects);
      resolve(b.motion, b.yaw, BOT_SHAPE, world.rects);
    }
    if (player?.active) {
      const dx = ax - player.x, dz = az - player.z;
      const d = Math.hypot(dx, dz);
      const min = BUMP_DIST + 0.35; // the shopper's own trolley is in front of the camera; keep a polite gap
      if (d < min) {
        const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
        a.motion.x += nx * (min - d);
        a.motion.z += nz * (min - d);
        bump(a);
        resolve(a.motion, a.yaw, BOT_SHAPE, world.rects);
      }
    }
  }
}

/** Startled little hop ("Oops!") when bumping into someone; dancers and shelf-starers just get nudged. */
function bump(b: Bot) {
  b.sprintT = 0; // a collision ends any run
  if (b.bumpCooldown > 0 || b.mode === "dance" || b.mode === "look") return;
  b.bumpCooldown = 3;
  setMode(b, "oops", 0.9);
}

// ---------------------------------------------------------------------------------------------------------
// Animation pose (what the renderer applies on top of position + yaw).

export interface BotPose {
  /** Extra height of the body (hops). */
  lift: number;
  /** Body yaw relative to the trolley (spins, looking sideways at a shelf, dancing). */
  turn: number;
  /** Side-to-side sway (rad, around the body's forward axis). */
  sway: number;
  /** Lean forward (rad). */
  lean: number;
  /** 0 = hands on the trolley handle, 1 = arms up in the air. */
  arms: number;
  /** Trolley rattle amount 0..1. */
  rattle: number;
  /** Speech bubble ("" = none). */
  say: string;
}

export const newPose = (): BotPose => ({ lift: 0, turn: 0, sway: 0, lean: 0, arms: 0, rattle: 0, say: "" });

/** Shouted when breaking into a run. */
export const RUN_LINES = ["Zoom!", "Coming through!", "Last one left!", "Beep beep!"] as const;

const SAY: Record<BotMode, readonly string[]> = {
  walk: [""],
  wait: [""],
  look: ["Hmm…", "Ooh, snacks!", "So many choices", "Price check…"],
  spin: ["Wheee!", "Spin to win!"],
  hop: ["Boing!", "Hop hop!"],
  dance: ["COMING SOON!", "Open up!", "Party!"],
  oops: ["Oops!", "Beep, sorry!", "My bad!"],
};

/** Pose for `t` seconds (clock), smoothly in and out of each mode. Writes into `out`, returns it. */
export function botPose(b: Bot, t: number, out: BotPose): BotPose {
  const p = b.mode;
  const k = b.modeT;
  const ease = Math.min(1, k / 0.25) * Math.min(1, Math.max(0, (b.modeLen - k) / 0.25));
  const wob = b.persona.wobble;
  out.lift = 0;
  out.turn = 0;
  out.lean = 0;
  out.arms = 0;
  out.rattle = 0;
  // Waddle while walking (and leftover sway in other modes).
  const speed = Math.hypot(b.motion.vx, b.motion.vz);
  out.sway = Math.sin(b.walkT * 5.5) * 0.06 * (0.4 + wob) * Math.min(1, speed);
  out.lift = Math.abs(Math.sin(b.walkT * 5.5)) * 0.035 * Math.min(1, speed);
  out.rattle = Math.min(1, speed / 1.5);
  const run = p === "walk" && b.sprintT > 0 ? Math.min(1, b.sprintAge / 0.3, b.sprintT / 0.4) : 0;
  if (run > 0) {
    // Head down, bouncy stride, arms pumping.
    out.lean = 0.3 * run;
    out.lift = Math.abs(Math.sin(b.walkT * 4)) * 0.12 * run;
    out.sway = Math.sin(b.walkT * 4) * 0.1 * run;
    out.arms = 0.25 * run;
  }
  if (p === "look") {
    out.turn = wrap((b.goal?.faceYaw ?? b.yaw) - b.yaw) * ease;
    out.lean = 0.22 * ease;
    out.sway = Math.sin(t * 1.7) * 0.08 * ease; // head tilt while pondering
  } else if (p === "spin") {
    const f = Math.min(1, k / b.modeLen);
    out.turn = (1 - Math.cos(f * Math.PI)) * Math.PI; // one full turn, ease in/out
    out.arms = Math.sin(f * Math.PI);
    out.lift = Math.sin(f * Math.PI) * 0.08;
  } else if (p === "hop" || p === "oops") {
    const n = p === "hop" ? 3 : 1;
    const ph = (k / b.modeLen) * n;
    out.lift = Math.abs(Math.sin(ph * Math.PI)) * (p === "hop" ? 0.32 : 0.22);
    out.arms = p === "oops" ? 0.8 * ease : 0.3;
    out.lean = p === "oops" ? -0.25 * ease : 0;
    out.rattle = 1;
  } else if (p === "dance") {
    out.turn = wrap((b.goal?.faceYaw ?? b.yaw) - b.yaw) * ease + Math.sin(t * 4) * 0.5 * ease;
    out.lift = Math.abs(Math.sin(t * 8)) * 0.16 * ease;
    out.sway = Math.sin(t * 4) * 0.28 * ease;
    out.arms = (0.6 + 0.4 * Math.sin(t * 8)) * ease;
  }
  const lines = SAY[p];
  // Pick a line per mode instance (stable while the mode lasts); speak only for the first ~1.6 s.
  out.say = k < 1.6 && lines.length ? lines[Math.floor((b.walkT * 13.7 + b.modeLen * 7.3) % lines.length) % lines.length] ?? "" : "";
  if (p === "dance") out.say = k < 2.2 ? out.say : "";
  // sprintT + sprintAge is constant during a run, so the line stays the same while it shows.
  if (run > 0 && b.sprintAge < 1.4) out.say = RUN_LINES[Math.floor((b.sprintT + b.sprintAge) * 7) % RUN_LINES.length] ?? "";
  return out;
}
