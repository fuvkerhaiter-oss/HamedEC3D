/**
 * AliExpress Dropshipping (DS) API adapter, via the AliExpress Open Platform.
 * Requires an approved DS app (app key + secret) and a buyer-account access token authorised for that app.
 *
 * What it does: product + variant info, live variant price/stock, shipping options, order placement,
 * order status, tracking. What it does NOT do: pay the supplier. Orders placed through the DS API are
 * created UNPAID at AliExpress; the owner pays them in their AliExpress buyer account (DS Center / order
 * list). Status sync detects when they are paid. The adapter therefore never declares "supplierPayment".
 *
 * Methods used (verify in your app's API console before enabling — tested only against fakes):
 *   aliexpress.ds.product.get · aliexpress.ds.freight.query · aliexpress.trade.buy.placeorder
 *   aliexpress.trade.ds.order.get · aliexpress.logistics.ds.trackinginfo.query
 */
import { fromDecimalString, isCurrencyCode, type Money } from "../../money";
import {
  SupplierError,
  type SupplierAdapter,
  type SupplierOrderState,
  type SupplierOrderStatus,
  type SupplierPaymentState,
  type SupplierProductInfo,
  type SupplierShippingOption,
  type SupplierTracking,
  type SupplierTrackingEvent,
  type SupplierVariantInfo,
} from "../types";
import { createIopClient, type IopClient, type IopConfig } from "./iop";

export interface AliExpressOptions extends IopConfig {
  id: string;
  /** Country used for price/stock look-ups when none is given (ISO alpha-2). */
  defaultShipTo?: string;
  currency?: "USD" | "EUR";
  language?: string;
}

/** Credentials from env. Returns null when not configured (adapter unavailable). */
export function aliexpressConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Omit<AliExpressOptions, "id"> | null {
  const appKey = env.ALIEXPRESS_APP_KEY ?? "";
  const appSecret = env.ALIEXPRESS_APP_SECRET ?? "";
  const accessToken = env.ALIEXPRESS_ACCESS_TOKEN ?? "";
  if (!appKey || !appSecret || !accessToken) return null;
  return { appKey, appSecret, accessToken, endpoint: env.ALIEXPRESS_API_URL || undefined, currency: env.ALIEXPRESS_CURRENCY === "EUR" ? "EUR" : "USD" };
}

/** Our supplierSku for AliExpress lines: "<productId>" or "<productId>|<sku_attr>". */
export function aliexpressKey(productId: string, skuAttr?: string | null): string {
  return skuAttr ? `${productId}|${skuAttr}` : productId;
}
export function parseAliexpressKey(key: string): { productId: string; skuAttr: string | null } {
  const i = key.indexOf("|");
  const productId = (i < 0 ? key : key.slice(0, i)).trim();
  if (!/^\d{5,20}$/.test(productId)) throw new SupplierError(`Not an AliExpress product id: ${productId.slice(0, 40)}`, "invalid_request");
  return { productId, skuAttr: i < 0 ? null : key.slice(i + 1) || null };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
/** IOP wraps lists as { <name>: [...] }; accept either shape. */
const list = (v: unknown, inner?: string): Obj[] => {
  if (Array.isArray(v)) return v.map(obj);
  const o = obj(v);
  const k = inner ?? Object.keys(o)[0];
  return k && Array.isArray(o[k]) ? (o[k] as unknown[]).map(obj) : [];
};
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function priceOf(value: unknown, currency: unknown, fallback: "USD" | "EUR"): Money | null {
  const s = str(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cur = str(currency).toUpperCase();
  const c = isCurrencyCode(cur) ? cur : cur ? null : fallback;
  if (!c) return null; // a currency we cannot account for (e.g. CNY) is never guessed
  // AliExpress may return more decimals than the currency has: round UP (a cost is never understated).
  const [i, f = ""] = s.split(".");
  const m = fromDecimalString(`${i}.${(f + "00").slice(0, 2)}`, c);
  return /[1-9]/.test(f.slice(2)) ? { ...m, amount: m.amount + 1 } : m;
}

export const ALIEXPRESS_STATUS: Record<string, { state: SupplierOrderState; payment: SupplierPaymentState }> = {
  PLACE_ORDER_SUCCESS: { state: "accepted", payment: "pending" },
  RISK_CONTROL: { state: "accepted", payment: "pending" },
  WAIT_SELLER_EXAMINE_MONEY: { state: "accepted", payment: "pending" },
  WAIT_SELLER_SEND_GOODS: { state: "processing", payment: "paid" },
  FUND_PROCESSING: { state: "processing", payment: "paid" },
  SELLER_PART_SEND_GOODS: { state: "shipped", payment: "paid" },
  WAIT_BUYER_ACCEPT_GOODS: { state: "shipped", payment: "paid" },
  // FINISH is also used for orders closed without delivery → decided with tracking presence below.
  FINISH: { state: "delivered", payment: "paid" },
  IN_CANCEL: { state: "unknown", payment: "unknown" },
  IN_ISSUE: { state: "unknown", payment: "paid" },
  IN_FROZEN: { state: "unknown", payment: "unknown" },
};

export function mapAliexpressStatus(raw: string, hasTracking: boolean): { state: SupplierOrderState; payment: SupplierPaymentState } {
  const m = ALIEXPRESS_STATUS[raw];
  if (!m) return { state: "unknown", payment: "unknown" };
  if (raw === "FINISH" && !hasTracking) return { state: "unknown", payment: "unknown" };
  return m;
}

function trackingStatus(desc: string): SupplierTrackingEvent["status"] {
  const d = desc.toLowerCase();
  if (/delivered|signed|签收/.test(d)) return "delivered";
  if (/out for delivery|with courier|派送/.test(d)) return "out_for_delivery";
  if (/exception|failed|returned|undeliverable|customs hold/.test(d)) return "exception";
  if (/label|pre-advice|info received|created/.test(d)) return "label_created";
  return "in_transit";
}

export function createAliExpressAdapter(opts: AliExpressOptions, client: IopClient = createIopClient(opts)): SupplierAdapter {
  const currency = opts.currency ?? "USD";
  const shipTo = opts.defaultShipTo ?? "US";
  const language = opts.language ?? "en";

  async function product(productId: string, country: string, signal: AbortSignal) {
    const r = await client.call("aliexpress.ds.product.get", { product_id: productId, ship_to_country: country, target_currency: currency, target_language: language }, signal);
    const result = obj(r.result);
    if (!Object.keys(result).length) throw new SupplierError(`AliExpress product ${productId} not found or not available to ${country}`, "rejected");
    return result;
  }

  function variantsOf(result: Obj): SupplierVariantInfo[] {
    return list(obj(result.ae_item_sku_info_dtos), "ae_item_sku_info_d_t_o").map((s) => {
      const attributes: Record<string, string> = {};
      for (const p of list(obj(s.ae_sku_property_dtos), "ae_sku_property_d_t_o")) {
        attributes[str(p.sku_property_name) || "Option"] = str(p.property_value_definition_name) || str(p.sku_property_value);
      }
      const stock = Number(s.sku_available_stock ?? s.ipm_sku_stock);
      return {
        supplierVariantId: str(s.sku_attr) || str(s.sku_id),
        attributes,
        available: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : null,
        cost: priceOf(s.offer_sale_price ?? s.sku_price, s.currency_code, currency),
      };
    });
  }

  function pick(variants: SupplierVariantInfo[], skuAttr: string | null): SupplierVariantInfo | undefined {
    if (!skuAttr) return variants.length === 1 ? variants[0] : undefined;
    return variants.find((v) => v.supplierVariantId === skuAttr);
  }

  async function quote(keys: string[], signal: AbortSignal) {
    const out = new Map<string, SupplierVariantInfo | undefined>();
    const byProduct = new Map<string, Obj>();
    for (const key of keys) {
      const { productId, skuAttr } = parseAliexpressKey(key);
      if (!byProduct.has(productId)) byProduct.set(productId, await product(productId, shipTo, signal));
      out.set(key, pick(variantsOf(byProduct.get(productId)!), skuAttr));
    }
    return out;
  }

  return {
    id: opts.id,
    displayName: "AliExpress (DS API)",
    isMock: false,
    capabilities: new Set(["productInfo", "availability", "pricing", "shippingOptions", "submitOrder", "orderStatus", "tracking"]),

    async getProduct(key, signal): Promise<SupplierProductInfo> {
      const { productId } = parseAliexpressKey(key);
      const r = await product(productId, shipTo, signal);
      const base = obj(r.ae_item_base_info_dto);
      const media = obj(r.ae_multimedia_info_dto);
      return {
        supplierSku: productId,
        title: str(base.subject),
        description: undefined, // supplier HTML descriptions are never copied verbatim into the store
        imageUrls: str(media.image_urls).split(";").map((u) => u.trim()).filter((u) => u.startsWith("https://")),
        variants: variantsOf(r),
      };
    },

    async getAvailability(keys, signal) {
      const q = await quote(keys, signal);
      return keys.map((k) => ({ supplierSku: k, available: q.get(k)?.available ?? 0 }));
    },

    async getPricing(keys, signal) {
      const q = await quote(keys, signal);
      return keys.flatMap((k) => {
        const cost = q.get(k)?.cost;
        return cost ? [{ supplierSku: k, cost }] : [];
      });
    },

    async getShippingOptions(req, signal): Promise<SupplierShippingOption[]> {
      const r = await client.call("aliexpress.ds.freight.query", {
        queryDeliveryReq: { quantity: req.quantity, shipToCountry: req.countryCode, productId: req.supplierProductId, selectedSkuId: req.supplierVariantId ?? undefined, language, currency, locale: "en_US" },
      }, signal);
      const result = obj(r.result);
      return list(obj(result.delivery_options), "delivery_option_d_t_o").map((d) => ({
        method: str(d.code),
        label: str(d.company) || str(d.code),
        cost: d.free_shipping === true || str(d.free_shipping) === "true" ? { amount: 0, currency } : priceOf(obj(d.shipping_fee_cent).value ?? d.shipping_fee_format, obj(d.shipping_fee_cent).currency ?? d.shipping_fee_currency, currency),
        daysMin: Number.isFinite(Number(d.min_delivery_days)) ? Number(d.min_delivery_days) : null,
        daysMax: Number.isFinite(Number(d.max_delivery_days)) ? Number(d.max_delivery_days) : null,
        tracked: d.tracking === undefined ? null : str(d.tracking) === "true",
      })).filter((o) => o.method);
    },

    async submitOrder(req, signal) {
      const a = req.shipTo;
      const items = req.lines.map((l) => {
        const { productId, skuAttr } = parseAliexpressKey(l.supplierProductId ? aliexpressKey(l.supplierProductId, l.supplierVariantId) : l.supplierSku);
        if (!l.shippingMethod) throw new SupplierError(`No AliExpress shipping method mapped for product ${productId}`, "invalid_request");
        return { product_id: Number(productId), product_count: l.quantity, sku_attr: skuAttr ?? undefined, logistics_service_name: l.shippingMethod, order_memo: "Dropshipping order. Please do not include invoices or prices in the parcel." };
      });
      const r = await client.call("aliexpress.trade.buy.placeorder", {
        param_place_order_request4_open_api_d_t_o: {
          logistics_address: {
            full_name: a.fullName, contact_person: a.fullName, address: a.line1, address2: a.line2 ?? "",
            city: a.city, province: a.region ?? "", zip: a.postalCode, country: a.countryCode, mobile_no: a.phone ?? "", phone_country: "",
          },
          product_items: items,
        },
      }, signal);
      const result = obj(r.result);
      const ol = result.order_list;
      const rawIds: unknown[] = Array.isArray(ol) ? ol : Array.isArray(obj(ol).number) ? (obj(ol).number as unknown[]) : ol !== undefined && typeof ol !== "object" ? [ol] : [];
      const ids = rawIds.map(str).filter((s) => /^\d+$/.test(s));
      if (result.is_success === false || str(result.is_success) === "false" || !ids.length) {
        throw new SupplierError(`AliExpress refused the order: ${str(result.error_code) || "no order id returned"} ${str(result.error_msg)}`.trim(), "rejected");
      }
      return { supplierOrderRef: ids.join(",") };
    },

    async getOrderStatus(ref, signal): Promise<SupplierOrderStatus> {
      // A placement can be split into several AliExpress orders ("id1,id2"): the least advanced one wins.
      const ids = ref.split(",").map((s) => s.trim()).filter(Boolean);
      const statuses: SupplierOrderStatus[] = [];
      for (const id of ids) {
        const r = await client.call("aliexpress.trade.ds.order.get", { single_order_query: { order_id: id } }, signal);
        const result = obj(r.result);
        const raw = str(result.order_status);
        const logistics = list(obj(result.logistics_info_list), "aeop_order_logistics_info")[0];
        const trackingNumber = logistics ? str(logistics.logistics_no) : "";
        const tracking: SupplierTracking | undefined = trackingNumber ? { carrier: str(logistics!.logistics_service) || "AliExpress logistics", trackingNumber } : undefined;
        const m = mapAliexpressStatus(raw, !!tracking);
        statuses.push({ supplierOrderRef: id, state: m.state, paymentState: m.payment, raw, tracking });
      }
      return combineStatuses(ref, statuses);
    },

    async getTracking(ref, signal) {
      const status = await this.getOrderStatus!(ref, signal);
      if (!status.tracking) return null;
      const id = ref.split(",")[0]!.trim();
      try {
        const r = await client.call("aliexpress.logistics.ds.trackinginfo.query", {
          logistics_no: status.tracking.trackingNumber, origin: "ESCROW", out_ref: id, service_name: status.tracking.carrier, to_area: "",
        }, signal);
        const events = list(obj(r.details), "details").map((e) => ({
          status: trackingStatus(str(e.event_desc)),
          description: str(e.event_desc).slice(0, 500),
          location: str(e.address) || undefined,
          occurredAt: new Date(str(e.event_date)).toISOString(),
        })).filter((e) => e.description && !Number.isNaN(Date.parse(e.occurredAt)));
        return { ...status.tracking, events };
      } catch (e) {
        if (e instanceof SupplierError && e.retryable) throw e;
        return status.tracking; // tracking details are optional; the number itself is what matters
      }
    },
  };
}

const RANK: Record<SupplierOrderState, number> = { unknown: -1, rejected: -2, cancelled: -2, accepted: 0, processing: 1, shipped: 2, delivered: 3 };

export function combineStatuses(ref: string, all: SupplierOrderStatus[]): SupplierOrderStatus {
  if (!all.length) return { supplierOrderRef: ref, state: "unknown", paymentState: "unknown" };
  if (all.length === 1) return { ...all[0]!, supplierOrderRef: ref };
  const worst = [...all].sort((a, b) => RANK[a.state] - RANK[b.state])[0]!;
  const payments = new Set(all.map((s) => s.paymentState ?? "unknown"));
  const paymentState: SupplierPaymentState = payments.size === 1 ? [...payments][0]! : payments.has("pending") ? "pending" : "unknown";
  return { supplierOrderRef: ref, state: worst.state, paymentState, raw: all.map((s) => s.raw).join(","), tracking: all.find((s) => s.tracking)?.tracking };
}
