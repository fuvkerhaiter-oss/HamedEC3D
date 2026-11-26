import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WHEEL_SEGMENTS, segmentAtPointer, spinTarget, wheelNames } from "../../src/features/store3d/wing/lucky-wheel";
import { LUCKY_WHEEL, extensionColliders, luckyWheelCollider } from "../../src/features/store3d/env/extension";

test("every spin lands on the chosen name, clockwise, with the requested turns", () => {
  for (const count of [1, 2, 3, 7, 12, 30, 120]) {
    for (let winner = 0; winner < count; winner += Math.max(1, Math.floor(count / 5))) {
      for (const from of [0, 1.3, -40.2, 17]) {
        for (const jitter of [-0.5, -0.2, 0, 0.3, 0.9]) {
          const to = spinTarget(from, winner, count, 4, jitter);
          assert.equal(segmentAtPointer(to, count), winner, `count ${count} winner ${winner} from ${from} jitter ${jitter}`);
          assert.ok(from - to >= 4 * Math.PI * 2 - 1e-9, "at least 4 full turns");
          assert.ok(from - to < 5 * Math.PI * 2 + 1e-9, "less than one extra turn");
        }
      }
    }
  }
});

test("wheel names are trimmed, non-empty and capped", () => {
  assert.deepEqual(wheelNames([" Ana ", "", "  ", "Bo"]), ["Ana", "Bo"]);
  assert.equal(wheelNames(Array.from({ length: 500 }, (_, i) => `n${i}`)).length, MAX_WHEEL_SEGMENTS);
});

test("the wheel's stand blocks walking and stays inside the open hall", () => {
  const box = luckyWheelCollider();
  assert.ok(box.min[0] < LUCKY_WHEEL.x && box.max[0] > LUCKY_WHEEL.x);
  assert.ok(box.min[2] > -4.8, "clear of the moved fridge bank");
  const env = { interior: { min: [-12.749, 0, -6.672], max: [14.145, 5.87, 8.072] } } as Parameters<typeof extensionColliders>[0];
  assert.ok(extensionColliders(env).some((b) => b.min[0] === box.min[0] && b.max[2] === box.max[2]));
});
