import { test } from "node:test";
import assert from "node:assert/strict";
import { GRAB_RADIUS, gripChance, nearestPrize, sweep } from "../../src/features/store3d/wing/claw-machine";

test("sweep starts where the claw is, moves toward −limit and stays within bounds", () => {
  for (const start of [0.43, 0, -0.3, 0.5]) {
    assert.ok(Math.abs(sweep(0, 0.3, 0.5, start) - start) < 1e-9, `start ${start}`);
    assert.ok(sweep(0.1, 0.3, 0.5, start) < start || start === -0.5);
    for (let t = 0; t < 30; t += 0.07) {
      const v = sweep(t, 0.3, 0.5, start);
      assert.ok(v >= -0.5 - 1e-9 && v <= 0.5 + 1e-9, `t ${t} → ${v}`);
    }
  }
  // ping-pong: after a full period it is back at the start
  assert.ok(Math.abs(sweep(4 / 0.3, 0.3, 0.5, 0.2) - 0.2) < 1e-9);
});

test("nearestPrize picks the closest available prize within reach", () => {
  const spots = [
    { x: 0, z: 0 },
    { x: 0.05, z: 0 },
    { x: 0.4, z: 0.4 },
  ];
  assert.equal(nearestPrize(spots, [true, true, true], 0.06, 0), 1);
  assert.equal(nearestPrize(spots, [true, false, true], 0.06, 0), 0);
  assert.equal(nearestPrize(spots, [true, true, true], -0.3, -0.3), -1);
  assert.equal(nearestPrize(spots, [true, true, true], 0.4 + GRAB_RADIUS * 0.9, 0.4), 2);
});

test("grip is best dead centre and weak at the edge", () => {
  assert.ok(gripChance(0) > 0.75);
  assert.ok(gripChance(GRAB_RADIUS) < 0.15);
  assert.ok(gripChance(0.02) > gripChance(0.1));
});
