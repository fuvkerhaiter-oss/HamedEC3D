import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  addressProblems, allocateRevenue, checkCandidate, checkPurchase, countryAllowed, DEFAULT_RULES, parseRules, parseSwitch, retryDelayMs,
} from "../../src/lib/fulfillment/rules";
import { createIopClient, iopSign } from "../../src/lib/suppliers/aliexpress/iop";
import { combineStatuses, createAliExpressAdapter, mapAliexpressStatus, parseAliexpressKey } from "../../src/lib/suppliers/aliexpress/adapter";
import { SupplierError } from "../../src/lib/suppliers/types";

const signal = new AbortController().signal;

test("rules: defaults are safe and invalid stored values fall back per field", () => {
  assert.equal(parseSwitch(undefined).enabled, false, "automation off by default");
  assert.deepEqual(parseSwitch("garbage"), { enabled: false, killSwitch: true }, "unreadable switch fails closed");
  const r = parseRules({ minMarginBps: 2000, maxPriceIncreaseBps: "lots" });
  assert.equal(r.minMarginBps, 2000);
  assert.equal(r.maxPriceIncreaseBps, DEFAULT_RULES.maxPriceIncreaseBps);
});

test("rules: candidate checks catch stock, price increase, country, shipping method", () => {
  const base = { quantity: 2, expectedUnitCost: 1000, liveUnitCost: 1000, liveAvailable: 10, autoFulfill: true, supplierActive: true, supplierCountries: [], shipCountry: "IT", shippingMethod: "CAINIAO_STANDARD", requiresShippingMethod: true };
  assert.deepEqual(checkCandidate(base, DEFAULT_RULES), []);
  assert.match(checkCandidate({ ...base, liveAvailable: 1 }, DEFAULT_RULES)[0]!, /out of stock/);
  assert.deepEqual(checkCandidate({ ...base, liveUnitCost: 1100 }, DEFAULT_RULES), [], "exactly +10% is allowed");
  assert.match(checkCandidate({ ...base, liveUnitCost: 1101 }, DEFAULT_RULES)[0]!, /price rose/);
  assert.match(checkCandidate({ ...base, supplierCountries: ["US"] }, DEFAULT_RULES)[0]!, /does not ship to IT/);
  assert.match(checkCandidate({ ...base, shippingMethod: null }, DEFAULT_RULES)[0]!, /no supplier shipping method/);
  assert.match(checkCandidate(base, { ...DEFAULT_RULES, allowedShippingMethods: ["AE_STANDARD"] })[0]!, /not allowed/);
  assert.match(checkCandidate({ ...base, autoFulfill: false }, DEFAULT_RULES)[0]!, /disabled/);
});

test("rules: purchase checks margin, limit and convertibility", () => {
  const ok = checkPurchase({ revenue: 10_000, costInOrderCurrency: 5_000, costInLimitCurrency: 5_400, paymentFee: null }, DEFAULT_RULES);
  assert.equal(ok.ok, true);
  assert.equal(ok.profit, 10_000 - 5_000 - 300);
  assert.equal(ok.marginBps, 4700);
  const thin = checkPurchase({ revenue: 10_000, costInOrderCurrency: 8_500, costInLimitCurrency: 9_000, paymentFee: 290 }, DEFAULT_RULES);
  assert.equal(thin.ok, false);
  assert.match(thin.problems.join(), /margin 12\.1% is below/);
  assert.match(checkPurchase({ revenue: 100_000, costInOrderCurrency: 30_000, costInLimitCurrency: 30_000, paymentFee: 0 }, DEFAULT_RULES).problems.join(), /exceeds the limit/);
  assert.match(checkPurchase({ revenue: 100, costInOrderCurrency: null, costInLimitCurrency: null, paymentFee: 0 }, DEFAULT_RULES).problems.join(), /exchange rate/);
});

test("rules: address, countries, backoff, revenue allocation", () => {
  assert.deepEqual(addressProblems({ fullName: "Ann Lee", line1: "1 Main St", city: "Rome", postalCode: "00100", country: "IT", phone: "+39 333 1234567" }, null, { phoneRequired: true }), []);
  assert.deepEqual(addressProblems({ fullName: "A", line1: "", city: "", postalCode: "", country: "it" }, null, { phoneRequired: true }).length, 6);
  assert.equal(countryAllowed("FR", { ...DEFAULT_RULES, allowedCountries: ["IT"] }), false);
  assert.equal(countryAllowed("FR", DEFAULT_RULES), true);
  assert.deepEqual([1, 2, 3, 20].map(retryDelayMs), [60_000, 120_000, 240_000, 6 * 3600_000]);
  assert.equal(allocateRevenue({ total: 12_200, taxTotal: 2_200, subtotal: 10_000 }, 5_000), 5_000);
});

test("IOP signing: sorted key+value, HMAC-SHA256, uppercase hex", () => {
  const p = { method: "aliexpress.ds.product.get", app_key: "12345", timestamp: "1700000000000", sign_method: "sha256", product_id: "100" };
  const expected = createHmac("sha256", "secret").update("app_key12345methodaliexpress.ds.product.getproduct_id100sign_methodsha256timestamp1700000000000").digest("hex").toUpperCase();
  assert.equal(iopSign(p, "secret"), expected);
  assert.equal(iopSign({ ...p, sign: "ignored" }, "secret"), expected);
});

function fakeFetch(handler: (method: string, params: URLSearchParams) => unknown, status = 200): { fetch: typeof fetch; calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = [];
  return {
    calls,
    fetch: (async (_url: string, init: RequestInit) => {
      const params = new URLSearchParams(String(init.body));
      calls.push(params);
      return new Response(JSON.stringify(handler(params.get("method")!, params)), { status });
    }) as unknown as typeof fetch,
  };
}

const cfg = { appKey: "k", appSecret: "s", accessToken: "tok", now: () => 1_700_000_000_000 };

test("IOP client: signs requests, unwraps responses, classifies errors", async () => {
  const f = fakeFetch(() => ({ aliexpress_ds_product_get_response: { result: { ok: 1 } } }));
  const c = createIopClient({ ...cfg, fetch: f.fetch });
  assert.deepEqual(await c.call("aliexpress.ds.product.get", { product_id: "1", obj: { a: 1 } }, signal), { result: { ok: 1 } });
  const sent = f.calls[0]!;
  assert.equal(sent.get("obj"), '{"a":1}');
  const params = Object.fromEntries(sent.entries());
  assert.equal(params.sign, iopSign(params, "s"));
  assert.equal(params.access_token, "tok");

  const authErr = createIopClient({ ...cfg, fetch: fakeFetch(() => ({ code: "IllegalAccessToken", message: "bad" })).fetch });
  await assert.rejects(authErr.call("x.y", {}, signal), (e: SupplierError) => e.kind === "auth" && !e.retryable);
  const down = createIopClient({ ...cfg, fetch: fakeFetch(() => ({}), 503).fetch });
  await assert.rejects(down.call("x.y", {}, signal), (e: SupplierError) => e.retryable);
});

const productResponse = {
  aliexpress_ds_product_get_response: {
    result: {
      ae_item_base_info_dto: { subject: "Dog bowl" },
      ae_multimedia_info_dto: { image_urls: "https://ae01.example/a.jpg;http://insecure/b.jpg" },
      ae_item_sku_info_dtos: {
        ae_item_sku_info_d_t_o: [
          { sku_attr: "14:200#Red", sku_available_stock: 7, offer_sale_price: "3.456", currency_code: "USD", ae_sku_property_dtos: { ae_sku_property_d_t_o: [{ sku_property_name: "Color", sku_property_value: "Red" }] } },
          { sku_attr: "14:201#Blue", sku_available_stock: 0, offer_sale_price: "3.10", currency_code: "USD" },
        ],
      },
    },
  },
};

test("AliExpress adapter: product, variants, live price/stock", async () => {
  const ae = createAliExpressAdapter({ ...cfg, id: "sup", fetch: fakeFetch(() => productResponse).fetch });
  const p = await ae.getProduct!("1005001234567", signal);
  assert.equal(p.title, "Dog bowl");
  assert.deepEqual(p.imageUrls, ["https://ae01.example/a.jpg"], "only https images");
  assert.deepEqual(p.variants![0], { supplierVariantId: "14:200#Red", attributes: { Color: "Red" }, available: 7, cost: { amount: 346, currency: "USD" } });
  assert.deepEqual(await ae.getAvailability!(["1005001234567|14:201#Blue"], signal), [{ supplierSku: "1005001234567|14:201#Blue", available: 0 }]);
  assert.deepEqual(await ae.getPricing!(["1005001234567|14:200#Red"], signal), [{ supplierSku: "1005001234567|14:200#Red", cost: { amount: 346, currency: "USD" } }]);
  assert.deepEqual(await ae.getPricing!(["1005001234567|nope"], signal), [], "unknown variant → no price (never guessed)");
  assert.throws(() => parseAliexpressKey("abc"), /Not an AliExpress product id/);
});

test("AliExpress adapter: places orders with mapped variant + shipping method, refuses unsafe answers", async () => {
  let placed: unknown;
  const f = fakeFetch((method, params) => {
    if (method === "aliexpress.trade.buy.placeorder") {
      placed = JSON.parse(params.get("param_place_order_request4_open_api_d_t_o")!);
      return { aliexpress_trade_buy_placeorder_response: { result: { is_success: true, order_list: { number: [8100000001, 8100000002] } } } };
    }
    return {};
  });
  const ae = createAliExpressAdapter({ ...cfg, id: "sup", fetch: f.fetch });
  const shipTo = { fullName: "Ann Lee", line1: "1 Main St", city: "Austin", region: "TX", postalCode: "73301", countryCode: "US", phone: "5551234567" };
  const r = await ae.submitOrder!({ idempotencyKey: "o:s", orderId: "o", shipTo, lines: [{ supplierSku: "x", quantity: 2, supplierProductId: "1005001234567", supplierVariantId: "14:200#Red", shippingMethod: "CAINIAO_STANDARD" }] }, signal);
  assert.equal(r.supplierOrderRef, "8100000001,8100000002");
  const body = placed as { product_items: { product_id: number; sku_attr: string; product_count: number; logistics_service_name: string }[]; logistics_address: { country: string; zip: string } };
  assert.deepEqual([body.product_items[0]!.product_id, body.product_items[0]!.sku_attr, body.product_items[0]!.product_count, body.product_items[0]!.logistics_service_name], [1005001234567, "14:200#Red", 2, "CAINIAO_STANDARD"]);
  assert.equal(body.logistics_address.zip, "73301");

  await assert.rejects(ae.submitOrder!({ idempotencyKey: "o:s", orderId: "o", shipTo, lines: [{ supplierSku: "1005001234567", quantity: 1 }] }, signal), /No AliExpress shipping method/);
  const refused = createAliExpressAdapter({ ...cfg, id: "sup", fetch: fakeFetch(() => ({ aliexpress_trade_buy_placeorder_response: { result: { is_success: false, error_code: "B_DROPSHIPPER_DELIVERY_ADDRESS_VALIDATE_FAIL" } } })).fetch });
  await assert.rejects(refused.submitOrder!({ idempotencyKey: "o:s", orderId: "o", shipTo, lines: [{ supplierSku: "1005001234567", quantity: 1, shippingMethod: "X" }] }, signal), (e: SupplierError) => e.kind === "rejected" && /ADDRESS/.test(e.message));
});

test("AliExpress status mapping: payment is detected, FINISH without tracking is not 'delivered', split orders combine", async () => {
  assert.deepEqual(mapAliexpressStatus("PLACE_ORDER_SUCCESS", false), { state: "accepted", payment: "pending" });
  assert.deepEqual(mapAliexpressStatus("WAIT_SELLER_SEND_GOODS", false), { state: "processing", payment: "paid" });
  assert.deepEqual(mapAliexpressStatus("FINISH", false), { state: "unknown", payment: "unknown" });
  assert.deepEqual(mapAliexpressStatus("SOMETHING_NEW", true), { state: "unknown", payment: "unknown" });
  const c = combineStatuses("1,2", [
    { supplierOrderRef: "1", state: "shipped", paymentState: "paid", tracking: { carrier: "Cainiao", trackingNumber: "LP1" } },
    { supplierOrderRef: "2", state: "accepted", paymentState: "pending" },
  ]);
  assert.equal(c.state, "accepted");
  assert.equal(c.paymentState, "pending");

  const ae = createAliExpressAdapter({ ...cfg, id: "sup", fetch: fakeFetch(() => ({ aliexpress_trade_ds_order_get_response: { result: { order_status: "WAIT_BUYER_ACCEPT_GOODS", logistics_info_list: { aeop_order_logistics_info: [{ logistics_no: "LP00123", logistics_service: "CAINIAO_STANDARD" }] } } } })).fetch });
  const st = await ae.getOrderStatus!("8100000001", signal);
  assert.deepEqual([st.state, st.paymentState, st.tracking?.trackingNumber], ["shipped", "paid", "LP00123"]);
  assert.equal(ae.capabilities.has("supplierPayment"), false, "never claims to pay the supplier");
});

test("Stripe disputes map to payment.disputed (order untouched, flagged)", async () => {
  const { mapStripeEvent } = await import("../../src/lib/payments/stripe");
  const ev = mapStripeEvent({ id: "evt_d", type: "charge.dispute.created", created: 1_700_000_000, data: { object: { id: "dp_1", payment_intent: "pi_1", amount: 1234, currency: "eur", status: "needs_response", reason: "fraudulent", metadata: {} } } });
  assert.equal(ev?.type, "payment.disputed");
  assert.deepEqual(ev?.dispute, { id: "dp_1", status: "needs_response", reason: "fraudulent" });
  assert.deepEqual(ev?.amount, { amount: 1234, currency: "EUR" });
});

test("IOP /rest system API signing prefixes the API path", async () => {
  const { iopSignRest } = await import("../../src/lib/suppliers/aliexpress/iop");
  const p = { app_key: "1", code: "c", sign_method: "sha256", timestamp: "2" };
  const expected = createHmac("sha256", "s").update("/auth/token/createapp_key1codecsign_methodsha256timestamp2").digest("hex").toUpperCase();
  assert.equal(iopSignRest("/auth/token/create", p, "s"), expected);
});
