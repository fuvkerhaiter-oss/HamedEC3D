/**
 * Orders: creation (for checkout — atomic stock reservation), lifecycle transitions (ONLY via
 * `transitionOrder` + the DB `transition_order` function), notes, shipments, refunds and invoices.
 */
import { priceCart, type CartLineInput } from "../../cart/pricing";
import type { CatalogReader } from "../../catalog/types";
import { inTx, type Db, type Tx } from "../../db/client";
import { invertRate } from "../../fx";
import { marketForCountry } from "../../markets";
import type { CurrencyCode } from "../../money";
import { canTransition, ORDER_TRANSITIONS, transitionOrder, type ActorType, type OrderStatus, type TransitionEvidence } from "../../orders/state-machine";
import { assertFulfillmentEligible, FulfillmentEligibilityError } from "../../orders/fulfillment-eligibility";
import { getPaymentProvider } from "../../payments/registry";
import { StripeApiError } from "../../payments/stripe";
import type { PaymentProvider, ProviderRefundStatus } from "../../payments/types";
import { queueOrderEmail, queueOrderStatusEmail } from "../../email/outbox";
import { quoteShipping } from "../../shipping/quote";
import { sampleProductsAllowed } from "../../catalog/samples";
import { logActivity, type Actor } from "../audit";
import { loadCouponForCode } from "./coupons";
import { notify } from "./notifications";
import { getSetting } from "./settings";
import { enqueueFulfillmentJob } from "../../fulfillment/jobs";
import { loadShippingZones } from "./shipping";
import { mapProductRow, type ProductRow } from "../../catalog/source-map";

export class OrderError extends Error {
  override name = "OrderError";
}

// ───────────────────────── Creation (checkout) ─────────────────────────

export interface ShipTo {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode: string;
  country: string;
  phone?: string;
}

export interface CreateOrderInput {
  email: string;
  userId?: string | null;
  lines: CartLineInput[];
  shipTo: ShipTo;
  /** Billing address; omitted = same as shipTo. */
  billTo?: ShipTo;
  shippingMethodId: string;
  couponCode?: string | null;
  idempotencyKey: string;
  isTest?: boolean;
  customerNote?: string;
}

/** Catalog reader over the DB for specific variants (fresh prices + stock; includes unpublished so pricing can report it). */
export async function dbCatalogReader(db: Db, variantIds: string[]): Promise<CatalogReader & { weights: Map<string, number> }> {
  const ids = variantIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const rows = ids.length
    ? await db<{ row: ProductRow; weights: Record<string, number | null> }[]>`
      select json_build_object(
        'id', p.id, 'slug', p.slug, 'name', p.name, 'description', p.description,
        'status', case when p.deleted_at is null then p.status::text else 'archived' end,
        'is_mock', p.is_mock, 'category_id', p.category_id,
        'product_variants', (select json_agg(json_build_object('id', v.id, 'sku', v.sku, 'name', v.name, 'attributes', v.attributes,
            'is_active', v.is_active, 'sort_order', v.sort_order,
            'variant_prices', coalesce((select json_agg(json_build_object('currency', vp.currency, 'amount', vp.amount)) from public.variant_prices vp where vp.variant_id = v.id), '[]'::json),
            'inventory', (select json_build_object('quantity', i.quantity, 'reserved', i.reserved) from public.inventory i where i.variant_id = v.id)))
          from public.product_variants v where v.product_id = p.id),
        'product_3d_assets', '[]'::json, 'product_images', '[]'::json) as row,
        (select json_object_agg(v.id, v.weight_grams) from public.product_variants v where v.product_id = p.id) as weights
      from public.products p
      where p.id in (select product_id from public.product_variants where id = any(${ids}::uuid[]))`
    : [];
  const index = new Map<string, { product: ReturnType<typeof mapProductRow>; variant: ReturnType<typeof mapProductRow>["variants"][number] }>();
  const weights = new Map<string, number>();
  for (const r of rows) {
    const mapped = mapProductRow(r.row, "");
    // Sample products are never for sale where they are hidden (production): pricing reports them as unavailable.
    const product = mapped.isMock && !sampleProductsAllowed() ? { ...mapped, status: "archived" as const } : mapped;
    for (const v of product.variants) index.set(v.id, { product, variant: v });
    for (const [vid, w] of Object.entries(r.weights ?? {})) weights.set(vid, w ?? 0);
  }
  return { weights, async getVariant(id) { return index.get(id) ?? null; } };
}

export async function taxRateFor(db: Db, country: string, region?: string | null): Promise<number | null> {
  const rows = await db<{ basis_points: number }[]>`
    select basis_points from public.tax_rates
     where is_active and country = ${country.toUpperCase()} and (region = ${region ?? null} or region is null)
     order by region nulls last limit 1`;
  return rows[0]?.basis_points ?? null;
}

/** Latest rate converting `currency` → base, as a decimal string; null when not configured. */
export async function rateToBase(db: Db, currency: CurrencyCode, base: CurrencyCode): Promise<string | null> {
  if (currency === base) return "1";
  const direct = await db<{ rate: string }[]>`
    select rate::text from public.exchange_rates where base_currency = ${currency} and quote_currency = ${base} order by effective_at desc limit 1`;
  if (direct[0]) return direct[0].rate;
  const inverse = await db<{ rate: string }[]>`
    select rate::text from public.exchange_rates where base_currency = ${base} and quote_currency = ${currency} order by effective_at desc limit 1`;
  return inverse[0] ? invertRate(inverse[0].rate) : null;
}

/**
 * Creates a pending_payment order with server-computed totals and reserves stock atomically.
 * Any shortfall (including a concurrent buyer taking the last units) rolls the whole order back.
 * Idempotent on `idempotencyKey`.
 */
export async function createOrder(db: Db, input: CreateOrderInput): Promise<{ orderId: string; orderNumber: number; created: boolean }> {
  if (!marketForCountry(input.shipTo.country)) throw new OrderError(`We don't ship to ${input.shipTo.country}`);
  return inTx(db, async (tx) => {
    const existing = await tx<{ id: string; order_number: number }[]>`select id, order_number from public.orders where checkout_idempotency_key = ${input.idempotencyKey}`;
    if (existing[0]) return { orderId: existing[0].id, orderNumber: existing[0].order_number, created: false };

    const { market, priced, discount, couponId, option, taxBps } = await priceOrder(tx, input);

    const base = ((await getSetting(tx, "store.base_currency")) as CurrencyCode | null) ?? "EUR";
    const fx = await rateToBase(tx, market.currency, base);
    const [order] = await tx<{ id: string; order_number: number }[]>`
      insert into public.orders (user_id, email, currency, tax_mode, subtotal, discount_total, shipping_total, tax_total, total,
        shipping_address, ship_country, discount_code, checkout_idempotency_key, base_currency, fx_rate_to_base, shipping_method_name, is_test, customer_note,
        billing_address, tax_rate_bps, tax_country, tax_region, shipping_min_days, shipping_max_days)
      values (${input.userId ?? null}, ${input.email.trim().toLowerCase()}, ${market.currency}, ${market.taxMode}, ${priced.subtotal.amount},
        ${priced.discount.amount}, ${priced.shipping.amount}, ${priced.tax.amount}, ${priced.total.amount}, ${tx.json(JSON.parse(JSON.stringify(input.shipTo)))},
        ${input.shipTo.country.toUpperCase()}, ${discount?.code ?? null}, ${input.idempotencyKey}, ${base}, ${fx}, ${option.name}, ${input.isTest ?? false},
        ${input.customerNote ?? null},
        ${input.billTo ? tx.json(JSON.parse(JSON.stringify(input.billTo))) : null}, ${taxBps}, ${input.shipTo.country.toUpperCase()}, ${input.shipTo.region?.toUpperCase() ?? null},
        ${option.minDays}, ${option.maxDays})
      returning id, order_number`;
    for (const l of priced.lines) {
      await tx`insert into public.order_items (order_id, variant_id, product_name, variant_name, sku, unit_price, quantity, line_total)
               values (${order!.id}, ${l.variantId}, ${l.productName}, ${l.variantName}, ${l.sku}, ${l.unitPrice.amount}, ${l.quantity}, ${l.lineTotal.amount})`;
    }
    // Atomic, locked, all-or-nothing reservation (raises on oversell → transaction rolls back).
    await tx`select public.reserve_order_inventory(${order!.id}, ${tx.json(priced.lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity })))})`;
    if (couponId) await tx`insert into public.discount_redemptions (discount_id, order_id, user_id) values (${couponId}, ${order!.id}, ${input.userId ?? null})`;
    return { orderId: order!.id, orderNumber: order!.order_number, created: true };
  });
}

export type OrderPricingInput = Pick<CreateOrderInput, "lines" | "shipTo" | "email" | "couponCode"> & { shippingMethodId?: string | null };

/**
 * Server-side order pricing shared by checkout preview and order creation: fresh DB prices/stock, coupon,
 * admin-configured shipping and tax. Without `shippingMethodId` the cheapest available method is used.
 */
export async function priceOrder(db: Db, input: OrderPricingInput) {
  const market = marketForCountry(input.shipTo.country);
  if (!market) throw new OrderError(`We don't ship to ${input.shipTo.country}`);
  {
    const tx = db;
    const reader = await dbCatalogReader(tx, input.lines.map((l) => l.variantId));
    const draft = await priceCart(input.lines, reader, { currency: market.currency, taxMode: market.taxMode });
    if (!draft.purchasable) throw new OrderError(draft.issues[0]?.message ?? "Cart is empty");

    // Coupon (server-validated)
    let discount = null;
    let couponId: string | null = null;
    if (input.couponCode) {
      const lineCtx = await Promise.all(draft.lines.map(async (l) => {
        const found = await reader.getVariant(l.variantId);
        return { productId: l.productId, categoryId: found?.product.categoryId ?? "", lineTotal: l.lineTotal.amount };
      }));
      const { record, result } = await loadCouponForCode(tx, input.couponCode, { currency: market.currency, now: new Date(), lines: lineCtx }, input.email);
      if (!result.ok) throw new OrderError(result.reason);
      discount = result.discount;
      couponId = record!.id;
    }

    // Shipping (admin-configured rates)
    const weight = draft.lines.reduce((s, l) => s + (reader.weights.get(l.variantId) ?? 0) * l.quantity, 0);
    const discounted = await priceCart(input.lines, reader, { currency: market.currency, taxMode: market.taxMode, discount });
    const options = quoteShipping(await loadShippingZones(tx), {
      country: input.shipTo.country, currency: market.currency, subtotal: discounted.subtotal.amount - discounted.discount.amount, weightGrams: weight,
    });
    if (options.length === 0) throw new OrderError(`We can't ship to ${input.shipTo.country} yet`);
    const option = input.shippingMethodId
      ? options.find((o) => o.methodId === input.shippingMethodId)
      : [...options].sort((a, b) => a.amount.amount - b.amount.amount)[0];
    if (!option) throw new OrderError("The selected shipping method is not available for this destination");

    const bps = await taxRateFor(tx, input.shipTo.country, input.shipTo.region);
    if (bps === null) throw new OrderError(`No tax rate is configured for ${input.shipTo.country} — set it in Settings → Tax before selling there`);
    const priced = await priceCart(input.lines, reader, {
      currency: market.currency, taxMode: market.taxMode, discount, taxBasisPoints: bps,
      shipping: { methodId: option.methodId, label: option.name, amount: option.amount },
    });
    return { market, priced, discount, couponId, options, option, taxBps: bps };
  }
}

// ───────────────────────── Transitions ─────────────────────────

/**
 * The ONLY way the app changes order status: validates with `transitionOrder` (actor rules + evidence),
 * applies it with the DB `transition_order` (row lock + audit row; the DB trigger re-checks the transition),
 * then applies inventory side effects in the same transaction.
 */
export async function transitionOrderInDb(
  db: Db,
  orderId: string,
  to: OrderStatus,
  actor: { type: ActorType; id?: string; adminUserId?: string | null },
  opts: { reason?: string; evidence?: TransitionEvidence } = {},
): Promise<{ from: OrderStatus; to: OrderStatus }> {
  return inTx(db, async (tx) => {
    const [row] = await tx<{ status: OrderStatus; order_number: number }[]>`select status, order_number from public.orders where id = ${orderId} for update`;
    if (!row) throw new OrderError("Order not found");
    const audit = transitionOrder({ from: row.status, to, actor: { type: actor.type, id: actor.id }, reason: opts.reason, evidence: opts.evidence });
    await tx`select public.transition_order(${orderId}, ${to}, ${audit.actorType}, ${audit.actorId}, ${audit.reason}, ${tx.json(JSON.parse(JSON.stringify(audit.evidence)))})`;
    await applyInventoryEffects(tx, orderId, row.status, to, actor.adminUserId ?? null);
    await queueOrderStatusEmail(tx, orderId, row.status, to); // sent after commit (flushEmailOutbox)
    if (to === "paid") {
      await notify(tx, { kind: "new_order", title: `New paid order #${row.order_number}`, link: `/admin/orders/${orderId}`, dedupeKey: `paid:${orderId}` });
      // Same transaction as the verified payment: exactly one automatic-fulfillment job per paid order.
      await enqueueFulfillmentJob(tx, orderId);
    }
    if (to === "failed" && row.status !== "pending_payment") {
      await notify(tx, { kind: "order_failed", severity: "warning", title: `Order #${row.order_number} needs attention`, body: opts.reason ?? "", link: `/admin/orders/${orderId}` });
    }
    return { from: row.status, to };
  });
}

/** Stock follows the order: release on cancel / failed payment / refund before shipping; commit on shipment. */
async function applyInventoryEffects(tx: Tx, orderId: string, from: OrderStatus, to: OrderStatus, adminId: string | null) {
  const release = to === "cancelled" || (to === "failed" && from === "pending_payment") || to === "refunded";
  if (release) await tx`select public.settle_order_inventory(${orderId}, 'release', ${adminId})`;
  if (to === "shipped") await tx`select public.settle_order_inventory(${orderId}, 'commit', ${adminId})`;
}

/**
 * Row-locks the order and checks fulfillment eligibility (verified payment, re-checked with the provider).
 * Call inside a transaction, immediately before any fulfillment step. Throws OrderError with the reason.
 */
export async function requireFulfillmentEligible(tx: Db, orderId: string, getProvider: (id: string) => PaymentProvider | null = (id) => getPaymentProvider(id)) {
  try {
    return await assertFulfillmentEligible(tx, orderId, { getProvider });
  } catch (e) {
    if (e instanceof FulfillmentEligibilityError) throw new OrderError(`Fulfillment refused: ${e.message}`);
    throw e;
  }
}

/** Statuses an admin may pick in the UI. `paid` is excluded: only a verified provider webhook may mark an order paid. */
export function adminTargets(from: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((t) => t !== "paid" && t !== "refunded");
}

export async function adminTransition(db: Db, actor: Actor, orderId: string, to: OrderStatus, reason: string, evidence: TransitionEvidence = {}) {
  if (to === "paid") throw new OrderError("Orders become paid only from a verified payment confirmation");
  if (to === "refunded") throw new OrderError("Use “Refund” — the order becomes refunded when the provider confirms the refund");
  const [o] = await db<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId}`;
  if (!o) throw new OrderError("Order not found");
  if (!canTransition(o.status, to)) throw new OrderError(`Order cannot move from ${o.status} to ${to}`);
  return inTx(db, async (tx) => {
    // Entering fulfillment by hand needs the same verified-payment check as the supplier flow (re-verified with the provider).
    if (to === "processing" || to === "submitted_to_supplier") await requireFulfillmentEligible(tx, orderId);
    const res = await transitionOrderInDb(tx, orderId, to, { type: "admin", id: actor.id, adminUserId: actor.id }, { reason, evidence });
    await logActivity(tx, actor, { action: "order.transition", entity: "order", entityId: orderId, summary: `${res.from} → ${res.to}${reason ? `: ${reason}` : ""}`, before: { status: res.from }, after: { status: res.to } });
    return res;
  });
}

// ───────────────────────── Queries ─────────────────────────

export interface OrderListFilters {
  q?: string;
  status?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface OrderListRow {
  id: string;
  order_number: number;
  email: string;
  status: OrderStatus;
  currency: CurrencyCode;
  total: number;
  item_count: number;
  ship_country: string;
  created_at: Date;
  is_test: boolean;
}

export async function listOrders(db: Db, f: OrderListFilters): Promise<{ rows: OrderListRow[]; total: number }> {
  const pageSize = Math.min(f.pageSize ?? 25, 200);
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim() ?? "";
  const num = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
  const where = db`
    where (${f.status ?? null}::text is null or o.status::text = ${f.status ?? null})
      and (${f.from ?? null}::timestamptz is null or o.created_at >= ${f.from ?? null})
      and (${f.to ?? null}::timestamptz is null or o.created_at < ${f.to ?? null})
      and (${q} = '' or o.email ilike ${"%" + q + "%"} or o.order_number = ${num} or o.shipping_address->>'fullName' ilike ${"%" + q + "%"})`;
  const [count] = await db<{ n: number }[]>`select count(*)::int as n from public.orders o ${where}`;
  const rows = await db<OrderListRow[]>`
    select o.id, o.order_number, o.email, o.status, o.currency, o.total, o.ship_country, o.created_at, o.is_test,
           (select coalesce(sum(quantity), 0)::int from public.order_items i where i.order_id = o.id) as item_count
      from public.orders o ${where}
     order by o.created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
  return { rows, total: count?.n ?? 0 };
}

export async function getOrderDetail(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [order] = await db<(OrderListRow & {
    tax_mode: string; subtotal: number; discount_total: number; shipping_total: number; tax_total: number;
    shipping_address: ShipTo; discount_code: string | null; shipping_method_name: string | null; customer_note: string | null;
    base_currency: CurrencyCode | null; fx_rate_to_base: string | null; user_id: string | null; updated_at: Date;
  })[]>`select o.*, o.fx_rate_to_base::text as fx_rate_to_base from public.orders o where o.id = ${id}`;
  if (!order) return null;
  const [items, events, notes, shipments, payments, refunds, supplierOrders, invoice, reservations, failedAttempts] = await Promise.all([
    db<{ id: string; variant_id: string | null; product_name: string; variant_name: string; sku: string; unit_price: number; quantity: number; line_total: number }[]>`
      select * from public.order_items where order_id = ${id} order by sku`,
    db<{ id: number; from_status: string | null; to_status: string; actor_type: string; actor_id: string | null; reason: string | null; evidence: Record<string, unknown>; created_at: Date }[]>`
      select * from public.order_status_events where order_id = ${id} order by created_at, id`,
    db<{ id: string; body: string; is_customer_visible: boolean; created_at: Date; admin_email: string | null }[]>`
      select n.*, u.email as admin_email from public.order_notes n left join public.admin_users u on u.id = n.admin_user_id where n.order_id = ${id} order by n.created_at`,
    db<{ id: string; carrier: string; tracking_number: string; tracking_url: string | null; status: string; shipped_at: Date | null; delivered_at: Date | null; notes: string }[]>`
      select * from public.shipments where order_id = ${id} order by shipped_at nulls last`,
    db<{ id: string; provider: string; provider_payment_id: string | null; provider_session_id: string | null; status: string; amount: number; currency: CurrencyCode; refunded_amount: number; fee_amount: number | null; is_test: boolean; created_at: Date }[]>`
      select * from public.payments where order_id = ${id} order by created_at`,
    db<{ id: string; amount: number; currency: CurrencyCode; reason: string; status: string; provider: string | null; provider_refund_id: string | null; error: string | null; created_at: Date }[]>`
      select * from public.refunds where order_id = ${id} order by created_at`,
    db<{ id: string; supplier_name: string; status: string; supplier_order_ref: string | null; fulfillment_mode: string; cost_total: number | null; cost_currency: CurrencyCode | null; last_error: string | null; created_at: Date }[]>`
      select so.*, s.name as supplier_name from public.supplier_orders so join public.suppliers s on s.id = so.supplier_id where so.order_id = ${id} order by so.created_at`,
    db<{ invoice_number: string; issued_at: Date }[]>`select invoice_number, issued_at from public.invoices where order_id = ${id}`,
    db<{ variant_id: string; quantity: number; status: string }[]>`select variant_id, quantity, status from public.inventory_reservations where order_id = ${id}`,
    db<{ id: string; message: string | null; received_at: Date }[]>`
      select id, payload->>'failureMessage' as message, received_at from public.payment_events
       where order_id = ${id} and event_type = 'payment.attempt_failed' order by received_at desc limit 10`,
  ]);
  return { order, items, events, notes, shipments, payments, refunds, supplierOrders, invoice: invoice[0] ?? null, reservations, failedAttempts };
}

// ───────────────────────── Notes & shipments ─────────────────────────

export async function addOrderNote(db: Db, actor: Actor, orderId: string, body: string, customerVisible: boolean) {
  await inTx(db, async (tx) => {
    await tx`insert into public.order_notes (order_id, admin_user_id, body, is_customer_visible) values (${orderId}, ${actor.id}, ${body}, ${customerVisible})`;
    await logActivity(tx, actor, { action: "order.note", entity: "order", entityId: orderId, summary: customerVisible ? "Added customer-visible note" : "Added internal note" });
  });
}

/**
 * Records a shipment with a REAL tracking number supplied by the supplier/carrier (never generated here).
 * If the order is at supplier_accepted it moves to shipped (commits stock).
 */
export async function addShipment(
  db: Db, actor: Actor, orderId: string,
  s: { carrier: string; trackingNumber: string; trackingUrl?: string | null; notes?: string; supplierOrderId?: string | null; markShipped: boolean },
) {
  return inTx(db, async (tx) => {
    const [o] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId} for update`;
    if (!o) throw new OrderError("Order not found");
    if (["pending_payment", "cancelled", "failed", "refunded"].includes(o.status)) throw new OrderError(`Cannot add a shipment to an order that is ${o.status}`);
    const [ship] = await tx<{ id: string }[]>`
      insert into public.shipments (order_id, supplier_order_id, carrier, tracking_number, tracking_url, status, shipped_at, created_by, notes)
      values (${orderId}, ${s.supplierOrderId ?? null}, ${s.carrier}, ${s.trackingNumber}, ${s.trackingUrl ?? null}, 'in_transit', now(), ${actor.id}, ${s.notes ?? ""})
      returning id`;
    await logActivity(tx, actor, { action: "order.shipment", entity: "order", entityId: orderId, summary: `Shipment ${s.carrier} ${s.trackingNumber}`, after: s });
    if (s.markShipped && o.status === "supplier_accepted") {
      await transitionOrderInDb(tx, orderId, "shipped", { type: "admin", id: actor.id, adminUserId: actor.id }, {
        reason: "Shipment recorded", evidence: { trackingNumber: s.trackingNumber, carrier: s.carrier },
      });
    }
    return ship!.id;
  });
}

export async function updateShipmentStatus(db: Db, actor: Actor, shipmentId: string, status: "in_transit" | "out_for_delivery" | "delivered" | "exception") {
  await inTx(db, async (tx) => {
    const [sh] = await tx<{ order_id: string; status: string }[]>`
      update public.shipments set status = ${status}, delivered_at = case when ${status} = 'delivered' then now() else delivered_at end, updated_at = now()
       where id = ${shipmentId} returning order_id, status`;
    if (!sh) throw new OrderError("Shipment not found");
    await logActivity(tx, actor, { action: "shipment.status", entity: "order", entityId: sh.order_id, summary: `Shipment → ${status}` });
    // When every shipment of a shipped order is delivered, the order is delivered (customer is emailed once).
    if (status === "delivered") {
      const [st] = await tx<{ status: OrderStatus; open: number }[]>`
        select o.status, (select count(*)::int from public.shipments s where s.order_id = o.id and s.status <> 'delivered') as open
          from public.orders o where o.id = ${sh.order_id} for update`;
      if (st?.status === "shipped" && st.open === 0) {
        await transitionOrderInDb(tx, sh.order_id, "delivered", { type: "admin", id: actor.id, adminUserId: actor.id }, { reason: "All shipments delivered" });
      }
    }
  });
}

// ───────────────────────── Refunds ─────────────────────────

/**
 * Refunds go through the payment provider that took the payment. Without provider credentials the refund
 * is NOT simulated: it is rejected and the admin is told to configure the provider (or refund manually
 * at the provider and record it as "manual").
 */
export async function refundOrder(
  db: Db, actor: Actor, orderId: string,
  r: { amount: number; reason: string; manual: boolean; manualReference?: string; requestId?: string },
  deps: { getProvider?: (id: string) => PaymentProvider | null } = {},
): Promise<{ status: string; refundId: string }> {
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) throw new OrderError("Refund amount must be positive");
  const getProvider = deps.getProvider ?? ((id: string) => getPaymentProvider(id));

  // Reserve the refund atomically: order + payment rows locked, so concurrent refunds can never exceed the
  // remaining refundable amount. Pending refunds count against the balance until the provider settles them.
  const reserved = await inTx(db, async (tx) => {
    const [order] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId} for update`;
    if (!order) throw new OrderError("Order not found");
    const [pay] = await tx<{ id: string; provider: string; provider_payment_id: string | null; amount: number; refunded_amount: number; currency: CurrencyCode }[]>`
      select id, provider, provider_payment_id, amount, refunded_amount, currency from public.payments
       where order_id = ${orderId} and status in ('succeeded','partially_refunded') order by created_at desc limit 1 for update`;
    if (!pay) throw new OrderError("This order has no successful payment to refund");
    const [{ reservedAmount, attempts } = { reservedAmount: 0, attempts: 0 }] = await tx<{ reservedAmount: number; attempts: number }[]>`
      select coalesce(sum(amount) filter (where status in ('pending','succeeded','manual')), 0)::bigint as "reservedAmount", count(*)::int as attempts
        from public.refunds where payment_id = ${pay.id}`;
    const refundable = refundableAmount(Number(pay.amount), Number(pay.refunded_amount), Number(reservedAmount));
    if (r.amount > refundable) throw new OrderError(`At most ${refundable} (minor units) can still be refunded`);

    // A double submit of the same form (same requestId) hits the UNIQUE key; without a requestId the serialised attempt number is used.
    const key = r.requestId ? `refund:${pay.id}:req:${r.requestId}` : `refund:${pay.id}:n:${attempts + 1}`;
    const provider = r.manual ? null : getProvider(pay.provider);
    const sendable = r.manual || (!!provider && !!pay.provider_payment_id);
    const [row] = await tx<{ id: string }[]>`
      insert into public.refunds (order_id, payment_id, amount, currency, reason, status, provider, idempotency_key, admin_user_id, provider_refund_id, error)
      values (${orderId}, ${pay.id}, ${r.amount}, ${pay.currency}, ${r.reason}, ${sendable ? "pending" : "failed"}, ${pay.provider}, ${key}, ${actor.id},
              ${r.manual ? r.manualReference ?? null : null}, ${sendable ? null : "Payment provider not configured — no refund was sent"})
      on conflict (idempotency_key) do nothing returning id`;
    if (!row) throw new OrderError("This refund was already submitted");
    await logActivity(tx, actor, { action: "order.refund", entity: "order", entityId: orderId, summary: `${r.manual ? "Manual refund recorded" : "Refund requested"}: ${r.amount} ${pay.currency}`, after: r });
    if (!sendable) {
      await notify(tx, { kind: "refund_failed", severity: "critical", title: "Refund could not be sent", body: `Provider ${pay.provider} is not configured.`, link: `/admin/orders/${orderId}` });
    }
    return { refundId: row.id, pay, key, sendable, provider, isFull: r.amount === refundable };
  });
  const { refundId, pay, key, provider } = reserved;

  if (r.manual) {
    await finalizeRefund(db, refundId, "manual", r.manualReference ?? null);
    return { status: "manual", refundId };
  }
  if (!reserved.sendable || !provider) {
    throw new OrderError(`The ${pay.provider} provider is not configured, so no refund was sent. Configure it, or refund at the provider and record a manual refund.`);
  }
  let res: { refundId: string; status: ProviderRefundStatus };
  try {
    res = await provider.refund(pay.provider_payment_id!, { amount: r.amount, currency: pay.currency }, key, { localRefundId: refundId, orderId });
  } catch (err) {
    const msg = String((err as Error).message).slice(0, 500);
    if (err instanceof StripeApiError && err.status >= 400 && err.status < 500) {
      // Definitive rejection: nothing was refunded.
      await markRefundFailed(db, refundId, msg);
      throw new OrderError(`The provider rejected the refund: ${msg}`);
    }
    // Network error / timeout / 5xx: the refund MAY exist at the provider. Keep it pending (amount stays reserved);
    // the provider's refund webhook (matched by metadata.local_refund_id) settles it.
    await db`update public.refunds set error = ${`Unconfirmed — check at ${pay.provider}: ${msg}`} where id = ${refundId} and status = 'pending'`;
    await notify(db, { kind: "refund_failed", severity: "critical", title: "Refund result unknown — check the payment provider", body: msg.slice(0, 300), link: `/admin/orders/${orderId}` });
    throw new OrderError(`No confirmation from the provider (${msg}). The refund is kept as pending until the provider reports it; check the provider dashboard.`);
  }
  await db`update public.refunds set provider_refund_id = ${res.refundId} where id = ${refundId} and provider_refund_id is null`;
  if (res.status === "succeeded") {
    await finalizeRefund(db, refundId, "succeeded", res.refundId);
    return { status: "succeeded", refundId };
  }
  if (res.status === "failed" || res.status === "canceled") {
    await markRefundFailed(db, refundId, `Provider reported the refund as ${res.status}`);
    throw new OrderError(`The provider reported the refund as ${res.status}`);
  }
  // Accepted but not settled yet: a full refund moves the order to refund_requested (blocks fulfillment); the webhook completes it.
  if (reserved.isFull) {
    await inTx(db, async (tx) => {
      const [o] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId} for update`;
      if (o && canTransition(o.status, "refund_requested")) {
        await transitionOrderInDb(tx, orderId, "refund_requested", { type: "admin", id: actor.id, adminUserId: actor.id }, { reason: r.reason });
      }
    });
  }
  return { status: "pending", refundId };
}

/** Remaining refundable amount: pending + settled refunds both count (prevents over-refunding while one is in flight). */
export function refundableAmount(paymentAmount: number, refundedAmount: number, reservedByRefunds: number): number {
  return Math.max(0, paymentAmount - Math.max(refundedAmount, reservedByRefunds));
}

/** Marks a pending refund failed (releases its reserved amount) and alerts an admin. Idempotent. */
export async function markRefundFailed(db: Db, refundId: string, error: string) {
  const [ref] = await db<{ order_id: string }[]>`
    update public.refunds set status = 'failed', error = ${error.slice(0, 500)} where id = ${refundId} and status = 'pending' returning order_id`;
  if (ref) {
    await notify(db, { kind: "refund_failed", severity: "critical", title: "Refund failed at the provider", body: error.slice(0, 300), link: `/admin/orders/${ref.order_id}` });
  }
  return !!ref;
}

/**
 * Settles a PENDING refund (provider confirmation or manual record): adds it to the payment's refunded
 * amount exactly once and completes the order when the payment is fully refunded. Returns false when the
 * refund was already settled (idempotent under webhook redelivery).
 */
export async function finalizeRefund(db: Db, refundId: string, status: "succeeded" | "manual", providerRefundId: string | null): Promise<boolean> {
  return inTx(db, async (tx) => {
    const [ref] = await tx<{ order_id: string; payment_id: string; amount: number }[]>`
      update public.refunds set status = ${status}, error = null, provider_refund_id = coalesce(provider_refund_id, ${providerRefundId})
       where id = ${refundId} and status = 'pending' returning order_id, payment_id, amount`;
    if (!ref) return false;
    const [o] = await tx<{ status: OrderStatus }[]>`select status from public.orders where id = ${ref.order_id} for update`;
    const [pay] = await tx<{ amount: number; refunded_amount: number }[]>`
      update public.payments set refunded_amount = least(amount, refunded_amount + ${ref.amount}),
        status = case when refunded_amount + ${ref.amount} >= amount then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end
       where id = ${ref.payment_id} returning amount, refunded_amount`;
    let orderRefunded = false;
    if (pay && Number(pay.refunded_amount) >= Number(pay.amount) && o) {
      let current = o.status;
      if (current !== "refund_requested" && canTransition(current, "refund_requested")) {
        await transitionOrderInDb(tx, ref.order_id, "refund_requested", { type: "system", id: "refund" }, { reason: "Payment fully refunded" });
        current = "refund_requested";
      }
      if (current === "refund_requested") {
        await transitionOrderInDb(tx, ref.order_id, "refunded", { type: status === "manual" ? "admin" : "payment_webhook", id: "refund" }, { reason: "Fully refunded" });
        orderRefunded = true; // the "order refunded" status email covers it
      }
    }
    if (!orderRefunded) {
      const [r] = await tx<{ currency: CurrencyCode }[]>`select currency from public.refunds where id = ${refundId}`;
      await queueOrderEmail(tx, ref.order_id, "refund_partial", `refund:${refundId}`, { refundAmount: { amount: Number(ref.amount), currency: r!.currency } });
    }
    return true;
  });
}

// ───────────────────────── Invoices ─────────────────────────

/** Issues (once) a sequential invoice number with a snapshot of the seller details from settings. */
export async function issueInvoice(db: Db, actor: Actor, orderId: string): Promise<string> {
  return inTx(db, async (tx) => {
    const [existing] = await tx<{ invoice_number: string }[]>`select invoice_number from public.invoices where order_id = ${orderId}`;
    if (existing) return existing.invoice_number;
    const [o] = await tx<{ status: OrderStatus; created_at: Date }[]>`select status, created_at from public.orders where id = ${orderId}`;
    if (!o) throw new OrderError("Order not found");
    if (["pending_payment", "cancelled", "failed"].includes(o.status)) throw new OrderError("Invoices are issued only for paid orders");
    const seller = (await getSetting(tx, "store.seller")) as Record<string, string> | null;
    if (!seller?.legalName || !seller?.address) throw new OrderError("Fill in the seller details in Settings before issuing invoices");
    const [{ n }] = (await tx<{ n: number }[]>`select nextval('public.invoice_number_seq')::int as n`) as unknown as [{ n: number }];
    const number = `INV-${new Date().getUTCFullYear()}-${String(n).padStart(6, "0")}`;
    await tx`insert into public.invoices (order_id, invoice_number, seller_snapshot) values (${orderId}, ${number}, ${tx.json(seller)})`;
    await logActivity(tx, actor, { action: "order.invoice", entity: "order", entityId: orderId, summary: `Issued invoice ${number}` });
    return number;
  });
}
