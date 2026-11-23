import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startTestDb, setupCommerce, IT_ADDRESS, variantBySku, type TestDb } from "./helpers";
import { startCheckout } from "../../src/lib/checkout/service";
import { createDevPaymentSimulator } from "../../src/lib/payments/dev-simulator";
import { addCustomerAddress, listCustomerAddresses, deleteCustomerAddress, setDefaultCustomerAddress } from "../../src/lib/account/addresses";
import { saveUserCart, loadUserCart } from "../../src/lib/cart/persistence";

let t: TestDb;
let euMethod: string;
const sim = createDevPaymentSimulator({ secret: "integration-test-auth-secret-16chars", baseUrl: "http://localhost", env: "test" });

before(async () => {
  t = await startTestDb("account-auth");
  ({ euMethod } = await setupCommerce(t.sql));
});

after(() => t.close());

test("account & auth: guest order claims on user creation and profile synchronization", async () => {
  const v = await variantBySku(t.sql, "MOCK-PASTA-PENNE-1");
  const guestEmail = "shopper-claims@test.local";

  // 1. Place order as guest
  const r = await startCheckout(t.sql, {
    email: guestEmail,
    lines: [{ variantId: v, quantity: 2 }],
    shipTo: IT_ADDRESS,
    shippingMethodId: euMethod,
    idempotencyKey: "guest-order-claim-1",
  }, { provider: sim, siteUrl: "http://shop.test" });

  const [orderBefore] = await t.sql<{ id: string; user_id: string | null; email: string }[]>`
    select id, user_id, email from public.orders where id = ${r.orderId}
  `;
  assert.equal(orderBefore?.user_id, null, "guest order has no user_id initially");
  assert.equal(orderBefore?.email, guestEmail);

  // 2. User creates an account with the matching email
  const userId = "11111111-2222-3333-4444-555555555555";
  await t.sql`
    insert into auth.users (id, email, raw_user_meta_data)
    values (${userId}, ${guestEmail}, ${t.sql.json({ full_name: "Trolley Pilot Bob" })})
  `;

  // 3. Verify profile was created by trigger
  const [profile] = await t.sql<{ id: string; email: string; full_name: string }[]>`
    select id, email, full_name from public.profiles where id = ${userId}
  `;
  assert.equal(profile?.id, userId);
  assert.equal(profile?.email, guestEmail);
  assert.equal(profile?.full_name, "Trolley Pilot Bob");

  // 4. Verify trigger automatically claimed the prior guest order!
  const [orderAfter] = await t.sql<{ id: string; user_id: string | null }[]>`
    select id, user_id from public.orders where id = ${r.orderId}
  `;
  assert.equal(orderAfter?.user_id, userId, "prior guest order was automatically associated with user_id");
});

test("account & auth: address management (add, default switch, delete)", async () => {
  const userId = "22222222-3333-4444-5555-666666666666";
  await t.sql`insert into auth.users (id, email) values (${userId}, 'addr-test@test.local')`;

  // 1. Add first address
  const id1 = await addCustomerAddress(t.sql, userId, {
    fullName: "Alice Smith",
    line1: "Via Roma 10",
    city: "Rome",
    postalCode: "00100",
    country: "IT",
    isDefault: true,
  });
  assert.ok(id1);

  // 2. Add second address as default
  const id2 = await addCustomerAddress(t.sql, userId, {
    fullName: "Alice Smith Work",
    line1: "Corso Italia 25",
    city: "Milan",
    postalCode: "20100",
    country: "IT",
    isDefault: true,
  });
  assert.ok(id2);

  const list = await listCustomerAddresses(t.sql, userId);
  assert.equal(list.length, 2);

  const addr2 = list.find((a) => a.id === id2);
  const addr1 = list.find((a) => a.id === id1);
  assert.equal(addr2?.isDefault, true, "second address is now default");
  assert.equal(addr1?.isDefault, false, "first address was automatically demoted from default");

  // 3. Set first address back to default
  await setDefaultCustomerAddress(t.sql, userId, id1!);
  const updatedList = await listCustomerAddresses(t.sql, userId);
  assert.equal(updatedList.find((a) => a.id === id1)?.isDefault, true);

  // 4. Delete an address
  const deleted = await deleteCustomerAddress(t.sql, userId, id2!);
  assert.equal(deleted, true);

  const finalList = await listCustomerAddresses(t.sql, userId);
  assert.equal(finalList.length, 1);
  assert.equal(finalList[0]?.id, id1);
});

test("account & auth: cart persistence and sync", async () => {
  const userId = "33333333-4444-5555-6666-777777777777";
  await t.sql`insert into auth.users (id, email) values (${userId}, 'cart-user@test.local')`;

  const v1 = await variantBySku(t.sql, "MOCK-PASTA-PENNE-1");
  const v2 = await variantBySku(t.sql, "MOCK-DARK-CHOCOLATE-1");

  // Save cart
  await saveUserCart(t.sql, userId, [
    { variantId: v1, quantity: 3 },
    { variantId: v2, quantity: 1 },
  ], "EUR");

  // Load cart
  const loaded = await loadUserCart(t.sql, userId);
  assert.equal(loaded.length, 2);
  assert.equal(loaded.find((l) => l.variantId === v1)?.quantity, 3);
  assert.equal(loaded.find((l) => l.variantId === v2)?.quantity, 1);

  // Update cart
  await saveUserCart(t.sql, userId, [
    { variantId: v1, quantity: 5 },
  ], "EUR");

  const reloaded = await loadUserCart(t.sql, userId);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0]?.variantId, v1);
  assert.equal(reloaded[0]?.quantity, 5);
});
