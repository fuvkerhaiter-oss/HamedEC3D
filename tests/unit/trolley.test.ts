import { test } from "node:test";
import assert from "node:assert/strict";
import { basketFloorY, basketSlot, expandUnits, flightPose, TROLLEY, unitJitter, unitKey } from "../../src/features/store3d/trolley/geometry";

test("basket floor follows the measured slope of the model", () => {
  assert.ok(Math.abs(basketFloorY(TROLLEY.basket.floorFront.z) - TROLLEY.basket.floorFront.y) < 1e-9);
  assert.ok(Math.abs(basketFloorY(TROLLEY.basket.floorBack.z) - TROLLEY.basket.floorBack.y) < 1e-9);
  assert.ok(basketFloorY(-0.3) > basketFloorY(0.1), "front is higher than back");
});

test("basket slots sit on the basket floor, inside the wire basket, and stack upward", () => {
  const { floorFront, floorBack, halfWidth, rimY } = TROLLEY.basket;
  for (let i = 0; i < TROLLEY.maxVisibleItems; i++) {
    const p = basketSlot(i)!;
    assert.ok(Math.abs(p[0]) < halfWidth, `slot ${i} x inside`);
    assert.ok(p[2] > floorFront.z && p[2] < floorBack.z, `slot ${i} z inside`);
    assert.ok(p[1] >= basketFloorY(p[2]) && p[1] < rimY, `slot ${i} rests on floor / below rim`);
  }
  assert.ok(basketSlot(12)![1] > basketSlot(0)![1], "second layer is higher");
  assert.equal(basketSlot(TROLLEY.maxVisibleItems), null);
  assert.equal(basketSlot(-1), null);
});

test("cart lines expand into stable per-unit keys, capped", () => {
  const map = new Map([["v1", "p1"], ["v2", "p2"]]);
  const units = expandUnits([{ variantId: "v1", quantity: 2 }, { variantId: "gone", quantity: 1 }, { variantId: "v2", quantity: 1 }], map);
  assert.deepEqual(units.map((u) => u.key), ["v1#0", "v1#1", "v2#0"]);
  assert.equal(expandUnits([{ variantId: "v1", quantity: 99 }], map).length, TROLLEY.maxVisibleItems);
  assert.equal(unitKey("v1", 3), "v1#3");
});

test("jitter is deterministic and small", () => {
  assert.equal(unitJitter("v1#0"), unitJitter("v1#0"));
  for (const k of ["a", "v1#0", "prod-x#12"]) assert.ok(Math.abs(unitJitter(k)) <= 0.3);
});

test("flight starts at the shelf, ends in the basket, arcs above both, and squashes on landing", () => {
  const from: [number, number, number] = [2, 1.2, -3];
  const to: [number, number, number] = [0, 0.5, 0];
  assert.deepEqual(flightPose(from, to, 0).position, from);
  const end = flightPose(from, to, 1);
  end.position.forEach((v, i) => assert.ok(Math.abs(v - to[i]!) < 1e-9));
  assert.ok(flightPose(from, to, 0.5).position[1] > from[1], "arc rises above the shelf");
  assert.equal(flightPose(from, to, 0.5).squash, 1);
  assert.ok(flightPose(from, to, 0.94).squash < 1, "squash during landing");
  assert.ok(Math.abs(flightPose(from, to, 1).squash - 1) < 1e-9, "settles back to full size");
  assert.deepEqual(flightPose(from, to, 2).position, end.position, "clamped");
});
