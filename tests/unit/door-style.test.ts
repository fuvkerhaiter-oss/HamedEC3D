import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DOOR_STYLE, DOOR_EFFECTS, DoorStyleInput, doorLightLevel, doorStyleFrom, rainbowHue } from "../../src/lib/rentals/door-style";
import { doorLightSegments } from "../../src/features/store3d/wing/ShopDoorLights";
import { toPublicShops } from "../../src/lib/rentals/public";
import { SHOP_DOOR } from "../../src/features/store3d/env/shops";

test("door style input: colours, effect and brightness are validated", () => {
  assert.deepEqual(DoorStyleInput.parse({ frame: "#AABBCC", light: " #ff2d7a ", effect: "chase", level: "40" }), { frame: "#aabbcc", light: "#ff2d7a", effect: "chase", level: 40 });
  for (const bad of [
    { frame: "red", light: "#ffffff", effect: "steady", level: "50" },
    { frame: "#000000", light: "#fff", effect: "steady", level: "50" },
    { frame: "#000000", light: "#ffffff", effect: "disco", level: "50" },
    { frame: "#000000", light: "#ffffff", effect: "steady", level: "101" },
    { frame: "#000000", light: "#ffffff", effect: "steady", level: "-1" },
  ]) assert.equal(DoorStyleInput.safeParse(bad).success, false, JSON.stringify(bad));
});

test("a DB row maps to a door style, anything odd falls back to the default", () => {
  assert.deepEqual(doorStyleFrom({ door_color: "#112233", door_light_color: "#445566", door_light_effect: "rainbow", door_light_level: 10 }), { frame: "#112233", light: "#445566", effect: "rainbow", level: 10 });
  assert.deepEqual(doorStyleFrom({}), DEFAULT_DOOR_STYLE);
  assert.deepEqual(doorStyleFrom({ door_color: "nope" }), DEFAULT_DOOR_STYLE);
});

test("light levels stay within 0–1; off is dark, steady is full, breathe and chase move", () => {
  for (const e of DOOR_EFFECTS) for (let t = 0; t < 10; t += 0.37) for (let u = 0; u <= 1; u += 0.05) {
    const v = doorLightLevel(e, t, u);
    assert.ok(v >= 0 && v <= 1, `${e} ${t} ${u} → ${v}`);
  }
  assert.equal(doorLightLevel("off", 3, 0.2), 0);
  assert.equal(doorLightLevel("steady", 3, 0.2), 1);
  assert.notEqual(doorLightLevel("breathe", 0, 0), doorLightLevel("breathe", 0.8, 0));
  assert.notEqual(doorLightLevel("chase", 0, 0.1), doorLightLevel("chase", 0.5, 0.1));
  const h = rainbowHue(-3, 1.7);
  assert.ok(h >= 0 && h < 1);
});

test("door light points cover the whole loop and sit on the door front, not inside the shop", () => {
  const segs = doorLightSegments(SHOP_DOOR.width, SHOP_DOOR.height, 0.2);
  assert.ok(segs.length > 60 && segs.length < 400, `${segs.length} points`);
  const us = segs.map((s) => s.u);
  assert.ok(Math.min(...us) < 0.02 && Math.max(...us) > 0.98);
  for (const s of segs) {
    assert.ok(s.p[2] > 0, "in front of the wall");
    assert.ok(s.p[1] >= 0 && s.s.every((v) => v > 0));
  }
});

test("public shops carry the tenant's door only while rented", () => {
  const until = new Date(Date.now() + 86_400_000);
  const door = { frame: "#111111", light: "#ff2d7a", effect: "chase" as const, level: 80 };
  const shops = toPublicShops(
    [
      { shopId: "shop-1", state: "rented", until, brand: "Acme" },
      { shopId: "shop-2", state: "held", until },
    ] as Parameters<typeof toPublicShops>[0],
    {},
    { "shop-1": door, "shop-2": door },
  );
  assert.deepEqual(shops.find((s) => s.id === "shop-1")!.door, door);
  assert.equal(shops.find((s) => s.id === "shop-2")!.door, null);
  assert.equal(shops.find((s) => s.id === "shop-3")!.door, null);
});
