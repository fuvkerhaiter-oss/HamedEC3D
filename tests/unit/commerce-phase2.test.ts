/** Phase 2: address validation, price-manipulation stripping, financial maths, history links, emails, config check. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { addressProblem } from "../../src/lib/shipping/address";
import { CheckoutBody } from "../../src/lib/checkout/schema";
import { computeProfit, orderBreakdown } from "../../src/lib/finance/profit";
import { historyToken, verifyHistoryToken } from "../../src/lib/checkout/order-history";
import { checkProductionConfig } from "../../src/lib/config-check";
import { orderEmail } from "../../src/lib/email/templates";
import type { CustomerOrderView } from "../../src/lib/checkout/order-view";
import { safeError } from "../../src/lib/log";

test("address validation: US needs a state and ZIP; other countries a postal code shape", () => {
  assert.equal(addressProblem({ country: "US", region: "NY", postalCode: "10001" }), null);
  assert.equal(addressProblem({ country: "US", region: "NY", postalCode: "10001-1234" }), null);
  assert.match(addressProblem({ country: "US", region: "", postalCode: "10001" })!, /state/);
  assert.match(addressProblem({ country: "US", region: "ZZ", postalCode: "10001" })!, /state/);
  assert.match(addressProblem({ country: "US", region: "CA", postalCode: "1234" })!, /ZIP/);
  assert.equal(addressProblem({ country: "IT", postalCode: "20100" }), null);
  assert.equal(addressProblem({ country: "NL", postalCode: "1012 AB" }), null);
  assert.match(addressProblem({ country: "DE", postalCode: "<script>" })!, /postal/);
});

const body = {
  lines: [{ variantId: "v1", quantity: 2 }], email: "A@B.co",
  shipTo: { fullName: "Ann Buyer", line1: "1 Main St", city: "Albany", region: "NY", postalCode: "12207", country: "us" },
  shippingMethodId: "m1", idempotencyKey: "abcdefghijklmnop1234", acceptTerms: true,
};

test("checkout body: client-sent prices/totals are stripped; invalid US address rejected", () => {
  const parsed = CheckoutBody.parse({ ...body, total: 1, lines: [{ variantId: "v1", quantity: 2, unitPrice: 1 }], currency: "XXX" });
  assert.equal("total" in parsed, false);
  assert.equal("currency" in parsed, false);
  assert.deepEqual(parsed.lines, [{ variantId: "v1", quantity: 2 }]);
  assert.equal(parsed.shipTo.country, "US");
  assert.equal(parsed.email, "a@b.co");
  assert.equal(CheckoutBody.safeParse({ ...body, shipTo: { ...body.shipTo, region: undefined } }).success, false);
  assert.equal(CheckoutBody.safeParse({ ...body, billTo: { ...body.shipTo, postalCode: "x" } }).success, false, "billing address validated too");
  assert.equal(CheckoutBody.safeParse({ ...body, lines: [{ variantId: "v1", quantity: 100 }] }).success, false, "quantity bound");
});

test("order breakdown: refunds remove their tax share (no double counting)", () => {
  // EU inclusive: total 12200 incl. 2200 VAT. Full refund → net revenue 0, tax kept 0.
  const full = orderBreakdown({ status: "refunded", currency: "EUR", subtotal: 11710, discount: 0, shipping: 490, tax: 2200, total: 12200, refunded: 12200, fee: 200, supplierCost: null });
  assert.deepEqual([full.netRevenue, full.taxKept, full.refundedNet, full.supplierCost], [0, 0, 10000, 0]);
  assert.equal(full.estimatedProfit, -200, "only the non-refundable Stripe fee is lost");
  // Partial refund of half.
  const half = orderBreakdown({ status: "delivered", currency: "EUR", subtotal: 11710, discount: 0, shipping: 490, tax: 2200, total: 12200, refunded: 6100, fee: 200, supplierCost: { amount: 3000, currency: "EUR", final: true } });
  assert.deepEqual([half.netRevenue, half.taxKept, half.estimatedProfit], [5000, 1100, 1800]);
  // Cost in another currency: unknown, never converted with an invented rate.
  const fx = orderBreakdown({ status: "paid", currency: "USD", subtotal: 1000, discount: 0, shipping: 0, tax: 0, total: 1000, refunded: 0, fee: null, supplierCost: { amount: 300, currency: "EUR", final: false } });
  assert.equal(fx.supplierCost, null);
  assert.equal(fx.estimatedProfit, null);
});

test("profit summary: fully refunded order is not charged tax twice nor a supplier cost", () => {
  const s = computeProfit([
    { id: "a", status: "refunded", currency: "EUR", total: 12200, taxTotal: 2200, fxRateToBase: null, supplierCostFinal: null, supplierCostEstimated: { amount: 3000, currency: "EUR" }, refunded: 12200, fee: 200 },
  ], [], "EUR", {});
  assert.deepEqual([s.revenue, s.refunds, s.tax, s.costOfGoods, s.fees, s.grossProfit], [10000, 10000, 0, 0, 200, -200]);
  assert.equal(s.missingCost, 0);
});

test("order-history links: bound to one email, tamper-proof, expire", () => {
  const now = Date.UTC(2026, 10, 21);
  const t = historyToken("Ann@Example.com", now);
  assert.equal(verifyHistoryToken(t, now + 1000), "ann@example.com");
  assert.equal(verifyHistoryToken(t, now + 25 * 3_600_000), null, "expired after 24 h");
  const [payload, sig] = t.split(".");
  const other = Buffer.from(JSON.stringify({ e: "bob@example.com", x: now + 3_600_000 })).toString("base64url");
  assert.equal(verifyHistoryToken(`${other}.${sig}`, now), null, "payload swap");
  assert.equal(verifyHistoryToken(`${payload}.${sig!.slice(0, -2)}xx`, now), null);
  assert.equal(verifyHistoryToken("garbage", now), null);
  assert.equal(verifyHistoryToken(t, now, { NODE_ENV: "test", ORDER_LINK_SECRET: "another-secret-that-is-long-enough-123" }), null, "other secret");
});

const view: CustomerOrderView = {
  id: "o", orderNumber: 100123, status: "shipped", email: "a@b.co", createdAt: "", taxMode: "inclusive",
  items: [{ name: "Tea", variant: "Default", quantity: 1, lineTotal: { amount: 500, currency: "EUR" } }],
  subtotal: { amount: 500, currency: "EUR" }, discount: { amount: 0, currency: "EUR" }, shipping: { amount: 490, currency: "EUR" },
  tax: { amount: 90, currency: "EUR" }, total: { amount: 990, currency: "EUR" }, shippingMethod: "Standard",
  shipTo: { fullName: "Ann Buyer", line1: "Via 1", city: "Milano", postalCode: "20100", country: "IT" },
  shipments: [{ carrier: "DHL", trackingNumber: "TRK1", trackingUrl: "https://track.example/TRK1", status: "in_transit" }],
  deliveryEstimate: { minDays: 3, maxDays: 6 }, taxRateBps: 2200, refunds: [],
};

test("emails: tracking + estimate wording, payment failure, delivered, partial refund", () => {
  const shipped = orderEmail("order_shipped", view, "https://x/order");
  assert.match(shipped.text, /DHL: TRK1/);
  assert.match(shipped.text, /3–6 business days \(an estimate, not a guaranteed date\)/);
  assert.match(orderEmail("payment_failed", view, "l").text, /not been charged/);
  assert.match(orderEmail("order_delivered", view, "l").subject, /delivered/);
  assert.match(orderEmail("refund_partial", view, "l", { refundAmount: { amount: 250, currency: "EUR" } }).text, /2,50/);
});

test("production config check: flags missing/unsafe settings by name, never values", () => {
  const good = {
    NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://shop.example", DATABASE_URL: "postgres://u:p@db.example.supabase.co:5432/postgres",
    ORDER_LINK_SECRET: "x".repeat(40), CRON_SECRET: "y".repeat(20), STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_ALLOW_LIVE: "true",
    STRIPE_WEBHOOK_SECRET: "whsec_abc", RESEND_API_KEY: "re_x", EMAIL_FROM: "shop@example.com", SUPPORT_EMAIL: "help@example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SECRET_KEY: "sb_secret_x",
  } as NodeJS.ProcessEnv;
  assert.deepEqual(checkProductionConfig(good).filter((i) => i.level === "error"), []);
  const bad = checkProductionConfig({ ...good, STRIPE_ALLOW_LIVE: undefined, NEXT_PUBLIC_LEAK: "sk_live_123", PAYMENT_PROVIDER: "dev-simulator" });
  assert.deepEqual(bad.filter((i) => i.level === "error").map((i) => i.key).sort(), ["NEXT_PUBLIC_LEAK", "PAYMENT_PROVIDER", "STRIPE_ALLOW_LIVE"]);
  assert.ok(bad.every((i) => !i.problem.includes("sk_live_123")), "values never echoed");
});

test("safe error logging drops query parameters and masks emails", () => {
  const e = Object.assign(new Error("duplicate key for ann@example.com"), { code: "23505", parameters: ["ann@example.com", "Via Roma 1"] });
  const s = JSON.stringify(safeError(e));
  assert.doesNotMatch(s, /ann@example|Via Roma/);
  assert.match(s, /23505/);
});
