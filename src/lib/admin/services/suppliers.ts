/**
 * Suppliers, supplier ↔ variant mappings and split supplier orders.
 * Manual mode: admin places the order with the supplier and records the reference.
 * API mode: goes through a SupplierAdapter (none real yet — see suppliers/registry.ts) with idempotent submission.
 */
import { inTx, type Db } from "../../db/client";
import type { CurrencyCode } from "../../money";
import { submitToSupplier, type FulfillmentStore, type SupplierOrderRecord } from "../../suppliers/fulfillment";
import { getSupplierAdapter } from "../../suppliers/registry";
import { splitOrderBySupplier, type SupplierMapping } from "../../suppliers/split";
import { logActivity, type Actor } from "../audit";
import { notify } from "./notifications";
import { requireFulfillmentEligible, transitionOrderInDb, OrderError, type ShipTo } from "./orders";
import type { PaymentProvider } from "../../payments/types";

/** Injectable payment-provider lookup for the fulfillment gate (tests); defaults to the configured providers. */
export interface FulfillmentDeps {
  getProvider?: (id: string) => PaymentProvider | null;
}

export interface SupplierRow {
  id: string;
  name: string;
  adapter_key: string;
  fulfillment_mode: "manual" | "api";
  is_active: boolean;
  is_mock: boolean;
  contact_email: string | null;
  website: string | null;
  notes: string;
  default_currency: CurrencyCode;
  lead_time_days: number | null;
  mapped_variants: number;
  open_orders: number;
  has_credentials: boolean;
}

export async function listSuppliers(db: Db): Promise<SupplierRow[]> {
  return db<SupplierRow[]>`
    select s.*, (select count(*)::int from public.supplier_products sp where sp.supplier_id = s.id) as mapped_variants,
      (select count(*)::int from public.supplier_orders so where so.supplier_id = s.id and so.status in ('submitting','manual_required','failed')) as open_orders,
      exists (select 1 from public.supplier_credentials c where c.supplier_id = s.id) as has_credentials
    from public.suppliers s order by s.is_active desc, s.name`;
}

export async function saveSupplier(db: Db, actor: Actor, s: {
  id?: string; name: string; adapterKey: string; fulfillmentMode: "manual" | "api"; isActive: boolean; contactEmail: string | null;
  website: string | null; notes: string; defaultCurrency: CurrencyCode; leadTimeDays: number | null;
}) {
  if (s.fulfillmentMode === "manual" && s.adapterKey !== "manual" && s.adapterKey !== "mock") s.adapterKey = "manual";
  const vals = {
    name: s.name, adapter_key: s.adapterKey, fulfillment_mode: s.fulfillmentMode, is_active: s.isActive, contact_email: s.contactEmail,
    website: s.website, notes: s.notes, default_currency: s.defaultCurrency, lead_time_days: s.leadTimeDays,
    is_mock: s.adapterKey === "mock",
  };
  if (s.id) {
    const [before] = await db`select * from public.suppliers where id = ${s.id}`;
    await db`update public.suppliers set ${db(vals)} where id = ${s.id}`;
    await logActivity(db, actor, { action: "supplier.update", entity: "supplier", entityId: s.id, summary: `Updated ${s.name}`, before, after: vals });
    return s.id;
  }
  const [row] = await db<{ id: string }[]>`insert into public.suppliers ${db(vals)} returning id`;
  await logActivity(db, actor, { action: "supplier.create", entity: "supplier", entityId: row!.id, summary: `Created ${s.name}`, after: vals });
  return row!.id;
}

export async function listMappings(db: Db, supplierId: string) {
  return db<{ id: string; supplier_sku: string; cost_amount: number; cost_currency: CurrencyCode; is_primary: boolean; shipping_days_min: number | null; shipping_days_max: number | null; sku: string; variant_name: string; product_name: string; product_id: string; last_synced_at: Date | null }[]>`
    select sp.*, v.sku, v.name as variant_name, p.name as product_name, p.id as product_id
      from public.supplier_products sp join public.product_variants v on v.id = sp.variant_id join public.products p on p.id = v.product_id
     where sp.supplier_id = ${supplierId} order by p.name, v.sku`;
}

export async function saveMapping(db: Db, actor: Actor, m: {
  supplierId: string; sku: string; supplierSku: string; costAmount: number; costCurrency: CurrencyCode; isPrimary: boolean; daysMin: number | null; daysMax: number | null;
}) {
  return inTx(db, async (tx) => {
    const [v] = await tx<{ id: string }[]>`select id from public.product_variants where sku = ${m.sku}`;
    if (!v) throw new Error(`No variant with SKU ${m.sku}`);
    if (m.isPrimary) await tx`update public.supplier_products set is_primary = false where variant_id = ${v.id}`;
    await tx`insert into public.supplier_products (supplier_id, variant_id, supplier_sku, cost_amount, cost_currency, is_primary, shipping_days_min, shipping_days_max)
             values (${m.supplierId}, ${v.id}, ${m.supplierSku}, ${m.costAmount}, ${m.costCurrency}, ${m.isPrimary}, ${m.daysMin}, ${m.daysMax})
             on conflict (supplier_id, supplier_sku) do update set variant_id = excluded.variant_id, cost_amount = excluded.cost_amount,
               cost_currency = excluded.cost_currency, is_primary = excluded.is_primary, shipping_days_min = excluded.shipping_days_min, shipping_days_max = excluded.shipping_days_max`;
    await logActivity(tx, actor, { action: "supplier.mapping", entity: "supplier", entityId: m.supplierId, summary: `Mapped ${m.sku} → ${m.supplierSku}`, after: m });
  });
}

export async function deleteMapping(db: Db, actor: Actor, supplierId: string, mappingId: string) {
  await db`delete from public.supplier_products where id = ${mappingId} and supplier_id = ${supplierId}`;
  await logActivity(db, actor, { action: "supplier.mapping.delete", entity: "supplier", entityId: supplierId, summary: "Removed a mapping" });
}

/** Postgres-backed FulfillmentStore (UNIQUE idempotency_key guarantees one submission per order+supplier). */
export function pgFulfillmentStore(db: Db, extra: { fulfillmentMode: "manual" | "api"; costTotal: number | null; costCurrency: CurrencyCode | null }): FulfillmentStore {
  const toRecord = (r: { idempotency_key: string; order_id: string; supplier_id: string; status: SupplierOrderRecord["status"]; supplier_order_ref: string | null; attempts: number; last_error: string | null }): SupplierOrderRecord => ({
    idempotencyKey: r.idempotency_key, orderId: r.order_id, supplierId: r.supplier_id, status: r.status,
    supplierOrderRef: r.supplier_order_ref, attempts: r.attempts, lastError: r.last_error,
  });
  return {
    async reserve(rec) {
      const inserted = await db<Parameters<typeof toRecord>[0][]>`
        insert into public.supplier_orders (order_id, supplier_id, idempotency_key, status, fulfillment_mode, cost_total, cost_currency)
        values (${rec.orderId}, ${rec.supplierId}, ${rec.idempotencyKey}, 'submitting', ${extra.fulfillmentMode}, ${extra.costTotal}, ${extra.costCurrency})
        on conflict (idempotency_key) do nothing returning *`;
      if (inserted[0]) return { created: true, record: toRecord(inserted[0]) };
      const [existing] = await db<Parameters<typeof toRecord>[0][]>`select * from public.supplier_orders where idempotency_key = ${rec.idempotencyKey}`;
      return { created: false, record: toRecord(existing!) };
    },
    async update(key, patch) {
      const [r] = await db<Parameters<typeof toRecord>[0][]>`
        update public.supplier_orders set
          status = coalesce(${patch.status ?? null}::public.supplier_order_status, status),
          supplier_order_ref = coalesce(${patch.supplierOrderRef ?? null}, supplier_order_ref),
          attempts = coalesce(${patch.attempts ?? null}::int, attempts),
          last_error = ${patch.lastError === undefined ? null : patch.lastError}
        where idempotency_key = ${key} returning *`;
      return toRecord(r!);
    },
  };
}

/**
 * Splits a paid order by supplier and creates one supplier order per supplier (idempotent).
 * Moves the order paid → processing. API suppliers are submitted through their adapter; manual ones
 * wait for an admin to record the supplier reference.
 */
export async function createSupplierOrders(db: Db, actor: Actor, orderId: string, deps: FulfillmentDeps = {}) {
  // Payment gate + move to processing under the order row lock: concurrent calls serialise here, and an order
  // whose payment is not verified (failed, pending, cancelled, refunded, mismatching) is refused.
  const order = await inTx(db, async (tx) => {
    const [o] = await tx<{ status: string; shipping_address: ShipTo; order_number: number }[]>`select status, shipping_address, order_number from public.orders where id = ${orderId} for update`;
    if (!o) throw new OrderError("Order not found");
    if (!["paid", "processing", "failed"].includes(o.status)) throw new OrderError(`Supplier orders can be created for paid orders (this one is ${o.status})`);
    await requireFulfillmentEligible(tx, orderId, deps.getProvider);
    if (o.status === "paid" || o.status === "failed") {
      await transitionOrderInDb(tx, orderId, "processing", { type: "admin", id: actor.id, adminUserId: actor.id }, { reason: "Fulfillment started" });
    }
    return o;
  });
  const items = await db<{ id: string; variant_id: string | null; sku: string; quantity: number }[]>`select id, variant_id, sku, quantity from public.order_items where order_id = ${orderId}`;
  const mappings = await db<{ variant_id: string; supplier_id: string; supplier_sku: string; cost_amount: number; cost_currency: CurrencyCode; is_primary: boolean }[]>`
    select sp.* from public.supplier_products sp join public.suppliers s on s.id = sp.supplier_id
     where s.is_active and sp.variant_id = any(${items.map((i) => i.variant_id).filter(Boolean) as string[]}::uuid[])`;
  const split = splitOrderBySupplier(
    items.map((i) => ({ orderItemId: i.id, variantId: i.variant_id, sku: i.sku, quantity: i.quantity })),
    mappings.map<SupplierMapping>((m) => ({ variantId: m.variant_id, supplierId: m.supplier_id, supplierSku: m.supplier_sku, costAmount: m.cost_amount, costCurrency: m.cost_currency, isPrimary: m.is_primary })),
  );
  const results: { supplierId: string; outcome: string }[] = [];
  for (const g of split.groups) {
    const [sup] = await db<{ name: string; adapter_key: string; fulfillment_mode: "manual" | "api" }[]>`select name, adapter_key, fulfillment_mode from public.suppliers where id = ${g.supplierId}`;
    const store = pgFulfillmentStore(db, { fulfillmentMode: sup!.fulfillment_mode, costTotal: g.costTotal?.amount ?? null, costCurrency: g.costTotal?.currency ?? null });
    let outcome: string;
    if (sup!.fulfillment_mode === "api") {
      let adapter;
      try {
        adapter = getSupplierAdapter(sup!.adapter_key, g.supplierId);
      } catch (e) {
        adapter = null;
        outcome = (e as Error).message;
      }
      if (adapter) {
        const res = await submitToSupplier(adapter, { orderId, lines: g.lines.map((l) => ({ supplierSku: l.supplierSku, quantity: l.quantity })), shipTo: toSupplierAddress(order.shipping_address) }, store);
        outcome = res.kind;
      } else {
        const { record } = await store.reserve({ idempotencyKey: `${orderId}:${g.supplierId}`, orderId, supplierId: g.supplierId, status: "submitting", supplierOrderRef: null, attempts: 0, lastError: null });
        if (record.status === "submitting") await store.update(record.idempotencyKey, { status: "manual_required", lastError: `No working API adapter for ${sup!.name} — place the order manually` });
        outcome = "manual_required";
      }
    } else {
      const { created, record } = await store.reserve({ idempotencyKey: `${orderId}:${g.supplierId}`, orderId, supplierId: g.supplierId, status: "submitting", supplierOrderRef: null, attempts: 0, lastError: null });
      if (created) await store.update(record.idempotencyKey, { status: "manual_required", lastError: null });
      outcome = created ? "manual_required" : record.status;
    }
    const [so] = await db<{ id: string }[]>`select id from public.supplier_orders where idempotency_key = ${`${orderId}:${g.supplierId}`}`;
    for (const l of g.lines) {
      await db`insert into public.supplier_order_items (supplier_order_id, order_item_id, supplier_sku, quantity, unit_cost, cost_currency)
               values (${so!.id}, ${l.orderItemId}, ${l.supplierSku}, ${l.quantity}, ${l.unitCost}, ${l.costCurrency}) on conflict do nothing`;
    }
    results.push({ supplierId: g.supplierId, outcome });
  }
  if (split.unassigned.length) {
    await notify(db, { kind: "unmapped_items", severity: "warning", title: `Order #${order.order_number}: ${split.unassigned.length} item(s) have no supplier`, link: `/admin/orders/${orderId}`, dedupeKey: `unmapped:${orderId}` });
  }
  await logActivity(db, actor, { action: "order.split", entity: "order", entityId: orderId, summary: `Created ${split.groups.length} supplier order(s)${split.unassigned.length ? `, ${split.unassigned.length} unassigned line(s)` : ""}`, after: results });
  await advanceIfAllSubmitted(db, actor, orderId);
  return { results, unassigned: split.unassigned.length };
}

function toSupplierAddress(a: ShipTo) {
  return { fullName: a.fullName, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postalCode, countryCode: a.country, phone: a.phone };
}

/** Manual mode: the admin placed the order with the supplier and records its reference (and optionally the real cost). */
export async function recordSupplierSubmission(
  db: Db, actor: Actor, supplierOrderId: string, ref: string, cost: { amount: number; currency: CurrencyCode } | null, deps: FulfillmentDeps = {},
) {
  await inTx(db, async (tx) => {
    const [target] = await tx<{ order_id: string }[]>`select order_id from public.supplier_orders where id = ${supplierOrderId}`;
    if (!target) throw new OrderError("Supplier order not found");
    // Revalidate payment eligibility (with the provider) immediately before recording the supplier order as placed.
    await requireFulfillmentEligible(tx, target.order_id, deps.getProvider);
    const [so] = await tx<{ order_id: string; status: string }[]>`
      update public.supplier_orders set status = 'submitted', supplier_order_ref = ${ref}, last_error = null,
        cost_total = coalesce(${cost?.amount ?? null}, cost_total), cost_currency = coalesce(${cost?.currency ?? null}, cost_currency)
       where id = ${supplierOrderId} returning order_id, status`;
    if (!so) throw new OrderError("Supplier order not found");
    await logActivity(tx, actor, { action: "supplier_order.submitted", entity: "order", entityId: so.order_id, summary: `Supplier reference ${ref} recorded`, after: { ref, cost } });
    await advanceIfAllSubmitted(tx, actor, so.order_id);
  });
}

/** When every supplier order of a processing order is submitted, the order moves to submitted_to_supplier. */
async function advanceIfAllSubmitted(db: Db, actor: Actor, orderId: string) {
  const [state] = await db<{ status: string; total: number; submitted: number; refs: string | null }[]>`
    select o.status, count(so.id)::int as total, count(so.id) filter (where so.status = 'submitted')::int as submitted,
      string_agg(so.supplier_order_ref, ', ') as refs
    from public.orders o left join public.supplier_orders so on so.order_id = o.id where o.id = ${orderId} group by o.status`;
  if (state && state.status === "processing" && state.total > 0 && state.total === state.submitted) {
    await transitionOrderInDb(db, orderId, "submitted_to_supplier", { type: "admin", id: actor.id, adminUserId: actor.id }, {
      reason: "All supplier orders submitted", evidence: { supplierOrderRef: state.refs ?? "" },
    });
  }
}

export async function listSupplierOrders(db: Db, f: { status?: string; supplierId?: string }) {
  return db<{ id: string; order_id: string; order_number: number; supplier_name: string; status: string; supplier_order_ref: string | null; fulfillment_mode: string; cost_total: number | null; cost_currency: CurrencyCode | null; last_error: string | null; attempts: number; created_at: Date; item_count: number }[]>`
    select so.*, o.order_number, s.name as supplier_name,
      (select coalesce(sum(quantity), 0)::int from public.supplier_order_items i where i.supplier_order_id = so.id) as item_count
      from public.supplier_orders so join public.orders o on o.id = so.order_id join public.suppliers s on s.id = so.supplier_id
     where (${f.status ?? null}::text is null or so.status::text = ${f.status ?? null})
       and (${f.supplierId ?? null}::uuid is null or so.supplier_id = ${f.supplierId ?? null})
     order by so.created_at desc limit 200`;
}
