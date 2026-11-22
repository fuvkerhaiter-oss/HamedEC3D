import { test } from "node:test";
import assert from "node:assert/strict";
import { slideLayers, stepIndex } from "../../src/features/store3d/hud/slideshow";

test("stepIndex wraps both ways", () => {
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(0, 0, 1), 0);
});

test("slideLayers mounts only the fading, visible and next photo", () => {
  assert.deepEqual(slideLayers(0, 0, 0), []);
  assert.deepEqual(slideLayers(0, 0, 1), [0]);
  assert.deepEqual(slideLayers(0, 0, 5), [0, 1]); // start: main photo + next preloaded
  assert.deepEqual(slideLayers(0, 1, 5), [0, 1, 2]);
  assert.deepEqual(slideLayers(4, 0, 5), [0, 1, 4]); // loop back to the main photo
  assert.deepEqual(slideLayers(3, 1, 5), [1, 2, 3]); // manual jump: no photos in between
});
