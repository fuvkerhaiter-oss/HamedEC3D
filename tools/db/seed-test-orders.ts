/**
 * LOCAL DEVELOPMENT ONLY: creates a few TEST orders (orders.is_test = true, shown with a TEST badge) through the
 * real order service, so admin screens can be exercised. Refuses to run against a non-local database.
 *   npm run db:seed-test-orders
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSql } from "../../src/lib/db/client";
import { createOrder, transitionOrderInDb } from "../../src/lib/admin/services/orders";

const env = readFileSync(path.resolve(import.meta.dirname, "..", "..", ".env.local"), "utf8");
const url = process.env.DATABASE_URL ?? /^DATABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
if (!url || !/@(127\.0\.0\.1|localhost):/.test(url)) {
  console.error("Refusing: DATABASE_URL must point to the local development database.");
  process.exit(1);
}
const sql = createSql(url, 2);
try {
  // Minimal TEST business config if none exists (clearly labelled; replace with accountant-confirmed values).
  const [{ n: taxes }] = (await sql<{ n: number }[]>`select count(*)::int as n from public.tax_rates`) as unknown as [{ n: number }];
  if (!taxes) await sql`insert into public.tax_rates (country, mode, basis_points, note) values ('IT','inclusive',2200,'TEST value — confirm with accountant'), ('US','exclusive',0,'TEST value — confirm with accountant')`;
  let [eu] = await sql<{ id: string }[]>`select m.id from public.shipping_methods m join public.shipping_zones z on z.id = m.zone_id where 'IT' = any(z.countries) and m.currency = 'EUR' limit 1`;
  if (!eu) {
    const [z] = await sql<{ id: string }[]>`insert into public.shipping_zones (name, countries) values ('Italy (TEST config)', ${["IT"]}) returning id`;
    [eu] = await sql<{ id: string }[]>`insert into public.shipping_methods (zone_id, name, carrier, rate_type, currency, fixed_amount, free_over_amount, min_days, max_days)
      values (${z!.id}, 'Standard (TEST)', null, 'fixed', 'EUR', 490, 4900, 2, 5) returning id`;
  }
  const variants = await sql<{ id: string; sku: string }[]>`
    select v.id, v.sku from public.product_variants v join public.products p on p.id = v.product_id join public.inventory i on i.variant_id = v.id
     where p.status = 'published' and p.deleted_at is null and i.quantity - i.reserved >= 3 order by v.sku limit 4`;
  const plans = [
    { lines: [0, 1], paid: true, key: "a" },
    { lines: [2], paid: true, key: "b" },
    { lines: [1, 3], paid: false, key: "c" },
  ];
  for (const p of plans) {
    const res = await createOrder(sql, {
      email: `test-buyer-${p.key}@example.com`,
      lines: p.lines.filter((i) => variants[i]).map((i) => ({ variantId: variants[i]!.id, quantity: 1 + (i % 2) })),
      shipTo: { fullName: `Test Buyer ${p.key.toUpperCase()}`, line1: "Via di Prova 1", city: "Milano", postalCode: "20100", country: "IT" },
      shippingMethodId: eu!.id, idempotencyKey: `dev-test-order-${p.key}`, isTest: true,
    });
    if (res.created && p.paid) {
      const [o] = await sql<{ total: number }[]>`select total from public.orders where id = ${res.orderId}`;
      await sql`insert into public.payments (order_id, provider, provider_payment_id, status, amount, currency, is_test)
                values (${res.orderId}, 'dev-simulator', ${`sim_pi_${p.key}_${res.orderNumber}`}, 'succeeded', ${o!.total}, 'EUR', true)`;
      await transitionOrderInDb(sql, res.orderId, "paid", { type: "payment_webhook", id: "dev-simulator" }, { evidence: { verifiedPaymentId: `sim_pi_${p.key}_${res.orderNumber}` }, reason: "TEST payment (dev simulator)" });
    }
    console.log(`${res.created ? "created" : "exists "} TEST order #${res.orderNumber}${p.paid ? " (paid via dev simulator)" : " (awaiting payment)"}`);
  }
} finally {
  await sql.end();
}
