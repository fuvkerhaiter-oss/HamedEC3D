import { test } from "node:test";
import assert from "node:assert/strict";
import { doorHoles, HALL_X0, SHOP_DOOR, SHOP_ROOM, SHOP_UNITS, WALL_FACES, wallFaceOf } from "../../src/features/store3d/env/shops";
import { FIXTURE_REMOVALS, fixtureRemovalFor } from "../../src/features/store3d/env/extension";
import { STORE_ENV } from "../../src/features/store3d/env/supermarket";

test("every door hole lies inside the rebuilt wall faces of its side, and holes don't overlap", () => {
  for (const side of ["N", "S"] as const) {
    const holes = doorHoles(side).sort((a, b) => a[0] - b[0]);
    assert.equal(holes.length + doorHoles(side, "hall").length, 2, "two shops per side");
    for (const f of WALL_FACES.filter((w) => w.side === side)) {
      // Main-wall holes stay west of the hall (whose plane would cover them) and inside the rebuilt faces.
      for (const [x0, x1, , y1] of holes) assert.ok(x0 > f.x0 && x1 < HALL_X0 - 0.2 && y1 < f.y1);
    }
    for (const [x0] of doorHoles(side, "hall")) assert.ok(x0 > HALL_X0);
    if (holes.length === 2) assert.ok(holes[1]![0] - holes[0]![1] > 3, `${side} doors need space between them`);
  }
});

test("shop rooms of one wall don't overlap and contain their door", () => {
  for (const side of ["N", "S"] as const) {
    const units = SHOP_UNITS.filter((u) => u.side === side).sort((a, b) => a.roomX0 - b.roomX0);
    for (const u of units) {
      // The door sits inside its room with at least a 0.5 m return to each partition.
      assert.ok(u.roomX0 + 0.5 < u.x - SHOP_DOOR.width / 2 && u.roomX1 - 0.5 > u.x + SHOP_DOOR.width / 2, `${u.id} door inside its room`);
      assert.equal(Math.round((u.roomX1 - u.roomX0) * 1000) / 1000, SHOP_ROOM.width, `${u.id} is 18 m wide`);
    }
    assert.ok(units[0]!.roomX1 <= units[1]!.roomX0);
  }
  assert.deepEqual([SHOP_ROOM.width, SHOP_ROOM.depth], [18, 24]);
  // Rooms behind the south windows stay clear of the entrance (x −12.22 → −7.69).
  for (const u of SHOP_UNITS.filter((x) => x.side === "S")) assert.ok(u.roomX0 > -7.69);
});

test("door fronts are clear of the store's fixtures along the wall (nothing in front of a shop)", () => {
  for (const u of SHOP_UNITS) {
    const z = u.side === "N" ? 7.6 : -6.2; // 0.5 m in front of the wall
    const blocked = [...STORE_ENV.fixtures, ...STORE_ENV.walls.filter((w) => w.max[1] < 3)].some((b) => b.min[0] < u.x + SHOP_DOOR.width / 2 && b.max[0] > u.x - SHOP_DOOR.width / 2 && b.min[2] < z && b.max[2] > z);
    assert.ok(!blocked, `${u.id} is blocked by a fixture`);
  }
});

test("wall faces are matched by plane + extent only; the freezer removal leaves floor and wall alone", () => {
  assert.equal(wallFaceOf([[0, 0, 8.072], [5, 0, 8.072], [0, 6, 8.072]])?.side, "N");
  assert.equal(wallFaceOf([[0, 0, -6.77], [5, 0, -6.77], [0, 6, -6.77]]), null, "south windows section is kept");
  assert.equal(wallFaceOf([[8, 0, -6.77], [14, 0, -6.77], [8, 6, -6.77]])?.side, "S");
  assert.equal(fixtureRemovalFor(10, 0.6, -6)?.id, "freezer-south");
  assert.equal(fixtureRemovalFor(4, 0.6, 7.6)?.id, "freezer-north");
  assert.equal(fixtureRemovalFor(10, -0.02, -6), null, "floor under the freezer stays");
  assert.equal(fixtureRemovalFor(4, 3, 8.07), null, "wall above stays");
  assert.ok(!STORE_ENV.fixtures.some((b) => FIXTURE_REMOVALS.some((f) => b.min[0] === f.collider.min[0] && b.min[2] === f.collider.min[2])), "colliders gone");
});

