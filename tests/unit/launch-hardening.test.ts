import assert from "node:assert/strict";
import { test } from "node:test";
import { analyticsUrl, cleanProps, deviceClass, searchResultsBucket } from "../../src/lib/analytics/events";
import { sampleProductsAllowed, withoutHiddenSamples } from "../../src/lib/catalog/samples";
import { alertWebhookUrl, shouldAlert } from "../../src/lib/monitoring";
import { windowStart } from "../../src/lib/rate-limit";
import { checkPaymentLink } from "../../src/lib/tenants/payment-links";
import { anonymizeIp } from "../../src/lib/visitors/parse";
import { multiplayerEnabled } from "../../src/features/store3d/multiplayer/rooms";

test("sample products: visible in development, hidden + unsellable in production unless explicitly allowed", () => {
  const items = [{ isMock: true, id: "a" }, { isMock: false, id: "b" }];
  assert.equal(sampleProductsAllowed({ NODE_ENV: "development" }), true);
  assert.equal(sampleProductsAllowed({ NODE_ENV: "production" }), false);
  assert.equal(sampleProductsAllowed({ NODE_ENV: "production", SHOW_SAMPLE_PRODUCTS: "1" }), false, "only the exact value 'true'");
  assert.equal(sampleProductsAllowed({ NODE_ENV: "production", SHOW_SAMPLE_PRODUCTS: "true" }), true);
  assert.deepEqual(withoutHiddenSamples(items, { NODE_ENV: "production" }).map((p) => p.id), ["b"]);
  assert.equal(withoutHiddenSamples(items, { NODE_ENV: "test" }).length, 2);
});

test("visitor log keeps only a shortened IP", () => {
  assert.equal(anonymizeIp("203.0.113.57", {}), "203.0.113.0");
  assert.equal(anonymizeIp("2001:db8:85a3:8d3:1319:8a2e:370:7348", {}), "2001:db8:85a3::");
  assert.equal(anonymizeIp("::1", {}), "::");
  assert.equal(anonymizeIp("unknown", {}), "unknown");
  assert.equal(anonymizeIp("203.0.113.57", { VISITOR_LOG_FULL_IP: "true" }), "203.0.113.57");
});

test("multiplayer is on unless explicitly switched off", () => {
  assert.equal(multiplayerEnabled(undefined, "production"), true);
  assert.equal(multiplayerEnabled("on", "production"), true);
  assert.equal(multiplayerEnabled("off", "production"), false);
  assert.equal(multiplayerEnabled(undefined, "development"), true);
  assert.equal(multiplayerEnabled("off", "development"), false);
});

test("analytics never carries query strings, tokens or emails", () => {
  assert.equal(analyticsUrl("https://shop.test/order?id=abc&t=signed"), "https://shop.test/order");
  assert.equal(analyticsUrl("https://shop.test/account/orders/123?x=1"), "https://shop.test/account");
  assert.equal(analyticsUrl("https://shop.test/catalog/cat-laser?utm_source=x"), "https://shop.test/catalog/cat-laser");
  assert.deepEqual(cleanProps({ product: "cat-laser", email: "a@b.c", category: "a@b.c", source: "x".repeat(80), method: "Standard", other: "1" }), { product: "cat-laser", method: "Standard" });
  assert.equal(deviceClass(390, true), "mobile");
  assert.equal(deviceClass(900, true), "tablet");
  assert.equal(deviceClass(1440, false), "desktop");
});

test("ops alerts: https webhook only, deduped per label", () => {
  assert.equal(alertWebhookUrl({}), null);
  assert.equal(alertWebhookUrl({ OPS_ALERT_WEBHOOK_URL: "http://hooks.example" }), null);
  assert.equal(alertWebhookUrl({ OPS_ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/x" }), "https://hooks.slack.com/services/x");
  const t0 = 1_000_000;
  assert.equal(shouldAlert("checkout failed", t0), true);
  assert.equal(shouldAlert("checkout failed", t0 + 60_000), false);
  assert.equal(shouldAlert("webhook failed", t0 + 60_000), true);
  assert.equal(shouldAlert("checkout failed", t0 + 11 * 60_000), true);
});

test("rate-limit windows and tenant links", () => {
  assert.equal(windowStart(125_000, 60_000).getTime(), 120_000);
  for (const bad of ["http://buy.stripe.com/x", "javascript:alert(1)", "https://user:pw@buy.stripe.com/x", "https://10.0.0.1/pay", "data:text/html,hi", "https://localhost/x"]) {
    assert.equal(checkPaymentLink(bad).ok, false, bad);
  }
  assert.equal(checkPaymentLink("https://www.wegoshiiip.com/x", ["wegoshiiip.com"]).ok, false, "no redirect back to us");
  const ok = checkPaymentLink("buy.stripe.com/abc#frag");
  assert.ok(ok.ok && ok.url === "https://buy.stripe.com/abc" && ok.provider?.id === "stripe");
});

test("search analytics: result-count bucket only, never the query text", () => {
  assert.deepEqual([0, 1, 5, 6, 200].map(searchResultsBucket), ["0", "1-5", "1-5", "6+", "6+"]);
  assert.deepEqual(cleanProps({ results: "0", q: "my name is anna" }), { results: "0" });
});
