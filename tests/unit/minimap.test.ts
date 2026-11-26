import { test } from "node:test";
import assert from "node:assert/strict";
import { aisleLabels, headingUpRotation, MAP_BOUNDS, mapFrame, mapHeading } from "../../src/features/store3d/map/map-geometry";
import { STORE_ENV } from "../../src/features/store3d/env/supermarket";
import { NEW_END_X } from "../../src/features/store3d/env/extension";

test("the map frame shows the whole store, top-down, entrance left", () => {
  const f = mapFrame(300);
  const { min, max } = STORE_ENV.interior;
  for (const [x, z] of [[min[0], min[2]], [NEW_END_X, max[2]]] as const) {
    assert.ok(f.px(x) >= 0 && f.px(x) <= f.width, `x ${x} on the map`);
    assert.ok(f.py(z) >= 0 && f.py(z) <= f.height, `z ${z} on the map`);
  }
  assert.ok(f.py(max[2]) > f.py(min[2]), "+z is down (top-down view, not mirrored)");
  assert.ok(f.px(NEW_END_X) > f.px(min[0]), "the hall/wing is to the right");
  assert.equal(f.height, Math.round((MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) * f.s));
});

test("player heading: yaw 0 looks −z (map up), −90° looks +x (map right)", () => {
  const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;
  assert.ok(near(mapHeading(0), -Math.PI / 2), "up");
  assert.ok(near(mapHeading(-Math.PI / 2), 0), "right");
  assert.ok(near(mapHeading(Math.PI), Math.PI / 2), "down");
});

test("the map is not mirrored: what is on the shopper's right is on the arrow's right", () => {
  // Facing +x (yaw −90°), the shopper's right hand points to +z (three.js: right = forward × up).
  const f = mapFrame(300);
  const h = mapHeading(-Math.PI / 2);
  const rightOfArrow = [Math.cos(h + Math.PI / 2), Math.sin(h + Math.PI / 2)]; // canvas: +90° is clockwise = right
  const worldRight = [f.px(0) - f.px(0), f.py(1) - f.py(0)]; // one metre to +z
  assert.ok(rightOfArrow[1]! * worldRight[1]! > 0, "same side");
});

test("heading-up rotation turns the heading to screen up", () => {
  for (const yaw of [0, 1, -2, 3]) {
    const h = mapHeading(yaw) + headingUpRotation(mapHeading(yaw));
    assert.ok(Math.abs(Math.atan2(Math.sin(h + Math.PI / 2), Math.cos(h + Math.PI / 2))) < 1e-9);
  }
});

test("aisle signs (one at each end of a run) become one label per aisle, centred", () => {
  const labels = aisleLabels([
    { text: "Pantry", position: [-6, 2.75, -1.3], rotationY: 0 },
    { text: "Pantry", position: [0.4, 2.75, -1.3], rotationY: 0 },
    { text: "Drinks", position: [3.7, 2.75, 2.4], rotationY: 0 },
  ]);
  assert.equal(labels.length, 2);
  assert.deepEqual(labels.find((l) => l.text === "Pantry"), { text: "Pantry", x: -2.8, z: -1.3 });
});
