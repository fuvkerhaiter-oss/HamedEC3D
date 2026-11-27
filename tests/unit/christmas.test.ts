import { test } from "node:test";
import assert from "node:assert/strict";
import {
  XMAS_LIGHT_SPANS,
  XMAS_ORNAMENTS,
  XMAS_TREE,
  christmasColliders,
  isChristmasSeason,
} from "../../src/features/store3d/env/christmas";
import { luckyWheelCollider, supportersStandCollider, updatesDisplayCollider } from "../../src/features/store3d/env/extension";
import { SHOP_DOOR, SHOP_UNITS } from "../../src/features/store3d/env/shops";
import { STORE_CONFIG, STORE_ENV, SUPERMARKET } from "../../src/features/store3d/env/supermarket";
import type { Box } from "../../src/features/store3d/env/types";

const overlaps = (a: Box, b: Box, pad = 0) =>
  a.min[0] - pad < b.max[0] && a.max[0] + pad > b.min[0] && a.min[2] - pad < b.max[2] && a.max[2] + pad > b.min[2];

test("christmas season: 15 Nov – 7 Jan, with an on/off override", () => {
  assert.equal(isChristmasSeason(new Date(2026, 10, 14)), false);
  assert.equal(isChristmasSeason(new Date(2026, 10, 15)), true);
  assert.equal(isChristmasSeason(new Date(2026, 11, 31)), true);
  assert.equal(isChristmasSeason(new Date(2027, 0, 7)), true);
  assert.equal(isChristmasSeason(new Date(2027, 0, 8)), false);
  assert.equal(isChristmasSeason(new Date(2026, 6, 1), "on"), true);
  assert.equal(isChristmasSeason(new Date(2026, 11, 24), "off"), false);
});

test("christmas props stay inside the store and clear of the spawn, shop doors and hall features", () => {
  const { min, max } = STORE_ENV.interior;
  const [sx, , sz] = STORE_CONFIG.spawn;
  const others = [luckyWheelCollider(), supportersStandCollider(), updatesDisplayCollider(SUPERMARKET), ...STORE_ENV.fixtures];
  for (const b of christmasColliders()) {
    assert.ok(b.min[0] > min[0] && b.max[0] < max[0] && b.min[2] > min[2] && b.max[2] < max[2], `inside the store: ${JSON.stringify(b)}`);
    assert.ok(!(sx > b.min[0] - 1 && sx < b.max[0] + 1 && sz > b.min[2] - 1 && sz < b.max[2] + 1), "spawn is clear");
    for (const o of others) assert.ok(!overlaps(b, o, 0.3), `clear of ${JSON.stringify(o)}: ${JSON.stringify(b)}`);
    // A 1.5 m approach in front of every shop door stays free.
    for (const u of SHOP_UNITS) {
      const wallZ = u.side === "N" ? max[2] : min[2];
      const approach: Box = {
        min: [u.x - SHOP_DOOR.width / 2, 0, u.side === "N" ? wallZ - 1.5 : wallZ],
        max: [u.x + SHOP_DOOR.width / 2, 2, u.side === "N" ? wallZ : wallZ + 1.5],
      };
      assert.ok(!overlaps(b, approach), `${u.label} door approach is clear: ${JSON.stringify(b)}`);
    }
  }
});

test("christmas tree stands against the south wall and leaves the hall open north of it", () => {
  const { min, max } = STORE_ENV.interior;
  const gapToWall = XMAS_TREE.z - XMAS_TREE.radius - min[2];
  assert.ok(gapToWall >= 0 && gapToWall < 0.6, `against the south wall (gap ${gapToWall.toFixed(2)} m)`);
  assert.ok(max[2] - (XMAS_TREE.z + XMAS_TREE.radius) > 8, "north passage > 8 m");
});

test("string lights and ornaments hang above head height and below the ceiling", () => {
  for (const s of XMAS_LIGHT_SPANS) {
    assert.ok(s.y < STORE_ENV.ceilingY && s.y - 1 > 2.6, `span at ${s.y}`);
  }
  for (const [, , top] of XMAS_ORNAMENTS) assert.ok(top - 0.9 > 2.5 && top < STORE_ENV.ceilingY);
});
