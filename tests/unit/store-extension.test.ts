import { test } from "node:test";
import assert from "node:assert/strict";
import { rectsFromBoxes, step, type Motion, type ShopperShape } from "../../src/features/store3d/collision";
import { FRIDGE_MOVES, GATE_X, NEW_END_X, OLD_END_X, extendLayout, fridgeMoveFor, moveXZ } from "../../src/features/store3d/env/extension";
import { STORE_ENV, SUPERMARKET } from "../../src/features/store3d/env/supermarket";
import type { Box } from "../../src/features/store3d/env/types";
import { chainLength, chainPoint, chainSegments } from "../../src/features/store3d/wing/chains";
import { TROLLEY } from "../../src/features/store3d/trolley/geometry";

const SHAPE: ShopperShape = {
  radius: 0.3,
  box: { offsetX: TROLLEY.collider.center[0], offsetZ: TROLLEY.collider.center[2], halfX: TROLLEY.collider.halfExtents[0], halfZ: TROLLEY.collider.halfExtents[2] },
};
const RECTS = rectsFromBoxes([...STORE_ENV.walls, ...STORE_ENV.fixtures]);
const FACING_PLUS_X = -Math.PI / 2;

/** Push the shopper (facing +x) along +x for a few seconds; returns where they end up. */
function walkEast(z: number, fromX: number, seconds = 12): Motion {
  const m: Motion = { x: fromX, z, vx: 0, vz: 0 };
  for (let i = 0; i < seconds * 30; i++) {
    m.vx = 3.5;
    m.vz = 0;
    step(m, FACING_PLUS_X, FACING_PLUS_X, 1 / 30, SHAPE, RECTS);
  }
  return m;
}

test("the old far wall is gone and the room now ends at the new far wall", () => {
  const acrossOldEnd = (w: Box) => w.max[0] - w.min[0] < 1 && w.max[0] > OLD_END_X - 0.5 && w.min[0] < OLD_END_X + 1 && w.max[2] - w.min[2] > 5;
  assert.ok(SUPERMARKET.walls.some(acrossOldEnd), "the imported layout had it");
  assert.ok(!STORE_ENV.walls.some(acrossOldEnd), "no wall left at the old end");
  assert.equal(STORE_ENV.interior.max[0], NEW_END_X);
  assert.ok(STORE_ENV.walls.some((w) => w.min[0] >= NEW_END_X - 0.01), "new far wall");
  assert.equal(extendLayout(SUPERMARKET).walls.length, STORE_ENV.walls.length, "deterministic");
});

test("fridge banks are moved, not deleted: same count, same size, inside the new hall", () => {
  assert.equal(STORE_ENV.fixtures.length, SUPERMARKET.fixtures.length);
  for (const f of FRIDGE_MOVES) {
    assert.ok(!STORE_ENV.fixtures.some((b) => b.min[0] === f.collider.min[0] && b.min[2] === f.collider.min[2]), `${f.id} left its old place`);
    const [ax, az] = moveXZ(f, f.collider.min[0], f.collider.min[2]);
    const [bx, bz] = moveXZ(f, f.collider.max[0], f.collider.max[2]);
    // A quarter turn swaps the footprint's sides.
    assert.ok(Math.abs(Math.abs(bx - ax) - (f.collider.max[2] - f.collider.min[2])) < 1e-6);
    assert.ok(Math.abs(Math.abs(bz - az) - (f.collider.max[0] - f.collider.min[0])) < 1e-6);
    for (const x of [ax, bx]) assert.ok(x > OLD_END_X && x < GATE_X - 0.35, `${f.id} x=${x.toFixed(2)} in the hall`);
    for (const z of [az, bz]) assert.ok(z >= SUPERMARKET.interior.min[2] - 0.05 && z <= SUPERMARKET.interior.max[2] + 0.05, `${f.id} z=${z.toFixed(2)} inside`);
  }
  assert.equal(fridgeMoveFor(13.5, 1, 0)?.id, "fridges-long");
  assert.equal(fridgeMoveFor(13.5, 1, 6)?.id, "fridges-short");
  assert.equal(fridgeMoveFor(13.5, 4, 0), null, "nothing above the fridges (wall/ceiling) moves");
  assert.equal(fridgeMoveFor(5, 1, 0), null);
});

test("a shopper walks from the old store into the new hall and is stopped by the chains", () => {
  const m = walkEast(2.3, 11.5);
  assert.ok(m.x > OLD_END_X + 3, `got into the new hall (x=${m.x.toFixed(2)})`);
  assert.ok(m.x < GATE_X - 0.55, `stopped before the chains (x=${m.x.toFixed(2)})`);
});

test("nobody gets into the wing past the fridge banks or the pillars either", () => {
  // Just in front of each moved fridge bank, and right along the walls.
  for (const z of [-4.3, 6.6, SUPERMARKET.interior.min[2] + 0.35, SUPERMARKET.interior.max[2] - 0.35]) {
    assert.ok(walkEast(z, OLD_END_X - 1.2).x < GATE_X - 0.5, `z=${z}`);
  }
});

test("chain segments tile the sagging curve end to end", () => {
  const span = { from: [0, 3, 0] as [number, number, number], to: [0, 0.5, 10] as [number, number, number], sag: 0.3 };
  const segs = chainSegments(span, 0.7);
  const len = chainLength(span);
  const total = segs.reduce((s, g) => s + g.scale, 0);
  assert.ok(Math.abs(total - len) / len < 0.01, `chords ≈ arc (${total.toFixed(3)} vs ${len.toFixed(3)})`);
  assert.equal(segs.length, Math.round(len / 0.7));
  for (const g of segs) assert.ok(Math.abs(Math.hypot(...g.dir) - 1) < 1e-9);
  // Lowest point is at the middle, `sag` below the straight line.
  assert.ok(Math.abs(chainPoint(span, 0.5)[1] - (1.75 - 0.3)) < 1e-9);
});
