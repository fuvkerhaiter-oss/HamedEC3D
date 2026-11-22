import { test } from "node:test";
import assert from "node:assert/strict";
import { rectsFromBoxes, resolve, step, type Motion, type ShopperShape } from "../../src/features/store3d/collision";
import { SUPERMARKET, STORE_CONFIG } from "../../src/features/store3d/env/supermarket";
import { TROLLEY } from "../../src/features/store3d/trolley/geometry";

const SHAPE: ShopperShape = {
  radius: 0.3,
  box: { offsetX: TROLLEY.collider.center[0], offsetZ: TROLLEY.collider.center[2], halfX: TROLLEY.collider.halfExtents[0], halfZ: TROLLEY.collider.halfExtents[2] },
};
// A 0.3 m thick wall along z at x ∈ [2, 2.3].
const WALL = rectsFromBoxes([{ min: [2, 0, -10], max: [2.3, 3, 10] }]);
const free = (m: Motion, yaw: number, rects = WALL) => !resolve({ ...m }, yaw, SHAPE, rects);

test("walking straight into a wall stops at it, even at running speed with a long frame", () => {
  const m: Motion = { x: 0, z: 0, vx: 3.8, vz: 0 }; // facing −z (yaw 0), moving +x
  for (let i = 0; i < 30; i++) step(m, 0, 0, 0.1, SHAPE, WALL);
  assert.ok(m.x < 2, "never passes through");
  assert.ok(m.x > 1.6, "gets right up to it");
  assert.ok(Math.abs(m.vx) < 1e-9, "velocity into the wall is removed");
});

test("diagonal movement slides along the wall instead of sticking", () => {
  const m: Motion = { x: 1.6, z: 0, vx: 2, vz: 2 };
  step(m, 0, 0, 0.5, SHAPE, WALL);
  assert.ok(m.z > 0.9, `slid along z (${m.z})`);
  assert.ok(m.x < 2);
});

test("the trolley in front collides too, and turning into a shelf pushes the shopper back", () => {
  // Facing +x (yaw −90°): trolley centre ~0.98 m ahead of the body.
  const yaw = -Math.PI / 2;
  const m: Motion = { x: 0, z: 0, vx: 3, vz: 0 };
  for (let i = 0; i < 20; i++) step(m, yaw, yaw, 0.1, SHAPE, WALL);
  assert.ok(m.x < 2 - 0.98 - 0.4, `stopped by the trolley, body at ${m.x.toFixed(2)}`);
  // Now facing −z next to the wall, then turn to face it: the trolley must not end up inside.
  const n: Motion = { x: 1.65, z: 0, vx: 0, vz: 0 };
  step(n, 0, 0, 1 / 60, SHAPE, WALL);
  step(n, 0, yaw, 1 / 60, SHAPE, WALL); // even a 90° snap in one frame
  assert.ok(free(n, yaw), "no overlap after turning");
  assert.ok(n.x < 2 - 0.98 - 0.4, `pushed back so the trolley fits (${n.x.toFixed(2)})`);
});

test("the real store layout: spawn point is free and the aisle is walkable", () => {
  const rects = rectsFromBoxes([...SUPERMARKET.walls, ...SUPERMARKET.fixtures]);
  assert.equal(rects.length, SUPERMARKET.walls.length + SUPERMARKET.fixtures.length);
  const [x, , z] = STORE_CONFIG.spawn;
  const m: Motion = { x, z, vx: 0, vz: 0 };
  assert.ok(free(m, STORE_CONFIG.spawnYaw, rects), "spawn is not inside a fixture");
  // Push forward (+x) for 3 s: moves along the aisle and stays out of every fixture.
  m.vx = 2.2;
  for (let i = 0; i < 180; i++) step(m, STORE_CONFIG.spawnYaw, STORE_CONFIG.spawnYaw, 1 / 60, SHAPE, rects);
  assert.ok(m.x > x + 3, `walked down the aisle (${(m.x - x).toFixed(2)} m)`);
  assert.ok(free(m, STORE_CONFIG.spawnYaw, rects));
});
