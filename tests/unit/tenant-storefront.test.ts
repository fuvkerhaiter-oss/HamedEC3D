import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPaymentLink, linkHost, providerOf } from "../../src/lib/tenants/payment-links";
import { ProductInput, ProfileInput } from "../../src/lib/tenants/schema";
import { DOOR_GAP, productSlots, shopColliders, unitFrame, wallsWithDoorGaps } from "../../src/features/store3d/env/shop-interior";
import { SHOP_DOOR, SHOP_UNITS } from "../../src/features/store3d/env/shops";
import { STORE_ENV } from "../../src/features/store3d/env/supermarket";
import { MAX_PRODUCTS } from "../../src/lib/tenants/service";
import type { Box } from "../../src/features/store3d/env/types";

test("payment links: providers recognised, unsafe links refused, normalised", () => {
  const s = checkPaymentLink("buy.stripe.com/test_abc123");
  assert.ok(s.ok && s.provider?.id === "stripe" && s.url === "https://buy.stripe.com/test_abc123");
  assert.equal(providerOf("https://www.paypal.com/ncp/payment/XYZ")?.id, "paypal");
  assert.equal(providerOf("https://my-brand.myshopify.com/cart/1:1")?.id, "shopify");
  const other = checkPaymentLink("https://pay.example.org/checkout#frag");
  assert.ok(other.ok && other.provider === null && !other.url.includes("#"));
  for (const bad of ["javascript:alert(1)", "http://buy.stripe.com/x", "https://user:pw@buy.stripe.com/x", "https://127.0.0.1/pay", "https://localhost/x", "data:text/html,hi", ""]) {
    assert.equal(checkPaymentLink(bad).ok, false, bad);
  }
  assert.equal(checkPaymentLink("https://shop.wegoshiiip.com/x", ["wegoshiiip.com"]).ok, false, "own site refused");
  assert.equal(linkHost("https://www.etsy.com/listing/1"), "etsy.com");
});

test("tenant forms: prices to minor units, handles cleaned, bad links rejected", () => {
  const p = ProductInput([]).safeParse({ title: "Rope toy", price: "24,90", currency: "EUR", paymentUrl: "buy.stripe.com/abc", publish: "on" });
  assert.ok(p.success);
  assert.equal(p.data.price, 2490);
  assert.equal(p.data.paymentUrl, "https://buy.stripe.com/abc");
  assert.equal(p.data.publish, true);
  assert.equal(ProductInput([]).safeParse({ title: "X y", price: "-1", currency: "EUR" }).success, false);
  assert.equal(ProductInput([]).safeParse({ title: "X y", price: "5", currency: "GBP" }).success, false);
  assert.equal(ProductInput([]).safeParse({ title: "X y", price: "5", currency: "EUR", paymentUrl: "javascript:alert(1)" }).success, false);

  const prof = ProfileInput([]).safeParse({ brandName: "Doggo", signName: "DOGGO", accentColor: "#F7C416", instagram: "https://instagram.com/doggo.co/", tiktok: "@doggo", website: "doggo.com" });
  assert.ok(prof.success);
  assert.equal(prof.data.instagram, "doggo.co");
  assert.equal(prof.data.tiktok, "doggo");
  assert.equal(prof.data.accentColor, "#f7c416");
  assert.equal(prof.data.website, "https://doggo.com/");
  assert.equal(ProfileInput([]).safeParse({ brandName: "Doggo", signName: "D", accentColor: "red" }).success, false);
});

const overlaps = (a: Box, b: Box) => a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[2] < b.max[2] && a.max[2] > b.min[2];

test("product slots: enough for the product limit, inside each shop's room, facing an aisle", () => {
  for (const u of SHOP_UNITS) {
    const slots = productSlots(u);
    assert.ok(slots.length >= MAX_PRODUCTS, `${u.id}: ${slots.length} slots`);
    const f = unitFrame(u);
    const wallZ = f.position[2];
    for (const s of slots) {
      assert.ok(s.position[0] > u.roomX0 && s.position[0] < u.roomX1, `${u.id} slot x inside the room`);
      // Behind the wall (rooms are outside the store): north rooms at larger z, south rooms at smaller z.
      assert.ok(u.side === "N" ? s.position[2] > wallZ + 0.5 : s.position[2] < wallZ - 0.5, `${u.id} slot behind the wall`);
      assert.ok(s.position[1] > 0.3 && s.position[1] < 2);
    }
    // Best slot is at eye level.
    assert.equal(slots[0]!.position[1], 1.41);
  }
});

test("open shop: a walk-through gap in the wall exactly at the door, room and fittings block", () => {
  const u = SHOP_UNITS[0]!;
  const walls = wallsWithDoorGaps(STORE_ENV.walls, [u]);
  const doorway: Box = { min: [u.x - DOOR_GAP / 2 + 0.05, 0, Math.min(8.07, 8.74) - 0.1], max: [u.x + DOOR_GAP / 2 - 0.05, 2, 8.8] };
  assert.ok(!walls.some((w) => w.min[1] < 1 && overlaps(w, doorway)), "nothing blocks the doorway");
  assert.ok(DOOR_GAP < SHOP_DOOR.width, "the glass side lites stay closed");
  // Closed shops keep their wall: the same doorway is blocked without the gap.
  assert.ok(STORE_ENV.walls.some((w) => w.min[1] < 1 && overlaps(w, doorway)));
  const room = shopColliders(u);
  assert.ok(!room.some((b) => overlaps(b, doorway)), "room colliders leave the doorway open");
  // Something blocks the room's far end and its sides.
  assert.ok(room.some((b) => b.min[2] > 30));
  assert.ok(room.some((b) => b.max[0] < u.roomX0 + 0.2) && room.some((b) => b.min[0] > u.roomX1 - 0.2));
});
