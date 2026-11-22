/**
 * Supplier status + tracking synchronisation for API suppliers. For each due supplier order:
 * asks the supplier for status / payment / tracking, then (in one transaction, order row locked)
 * records supplier payment, creates the shipment from the REAL tracking number, stores tracking events,
 * and advances the order (supplier_accepted → shipped → delivered) through the state machine as `supplier_sync`.
 * Customer emails (shipped, delivered) come from the existing outbox on those transitions.
 */
import { inTx, type Db } from "../db/client";
import { callSupplier, type RetryPolicy } from "../suppliers/call";
import { getSupplierAdapter } from "../suppliers/adapters";
import { SupplierError, type SupplierAdapter, type SupplierOrderStatus, type SupplierTracking, type SupplierTrackingEvent } from "../suppliers/types";
import { notify } from "../admin/services/notifications";
import { transitionOrderInDb } from "../admin/services/orders";
import type { OrderStatus } from "../orders/state-machine";
import { logAutomation } from "./jobs";

export interface SyncDeps {
  getAdapter?: (key: string, supplierId: string) => SupplierAdapter | null;
  retry?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
}

interface DueRow {
  id: string;
  order_id: string;
  supplier_id: string;
  supplier_order_ref: string;
  adapter_key: string;
  supplier_name: string;
  sync_failures: number;
  supplier_payment_status: string;
  created_at: Date;
}

const SYNC = "supplier_sync" as const;

export async function syncSupplierOrders(db: Db, opts: { limit?: number } & SyncDeps = {}): Promise<{ synced: number; errors: number }> {
  // Claim: push next_sync_at forward first so overlapping runs skip these rows.
  const due = await db<DueRow[]>`
    update public.supplier_orders so set next_sync_at = now() + interval '10 minutes'
      from public.suppliers s
     where s.id = so.supplier_id and so.id in (
       select so2.id from public.supplier_orders so2 join public.orders o on o.id = so2.order_id
        where so2.status = 'submitted' and so2.fulfillment_mode = 'api' and so2.supplier_order_ref is not null
          and coalesce(so2.next_sync_at, now()) <= now()
          and o.status in ('submitted_to_supplier', 'supplier_accepted', 'shipped')
        order by so2.next_sync_at nulls first limit ${opts.limit ?? 20} for update of so2 skip locked)
    returning so.id, so.order_id, so.supplier_id, so.supplier_order_ref, s.adapter_key, s.name as supplier_name, so.sync_failures,
              so.supplier_payment_status, so.created_at`;
  let synced = 0;
  let errors = 0;
  for (const row of due) {
    try {
      const adapter = (opts.getAdapter ?? getSupplierAdapter)(row.adapter_key, row.supplier_id);
      if (!adapter?.getOrderStatus) {
        await db`update public.supplier_orders set next_sync_at = null where id = ${row.id}`;
        continue;
      }
      const status = await callSupplier((sig) => adapter.getOrderStatus!(row.supplier_order_ref, sig), opts.retry, opts.sleep);
      let tracking: SupplierTracking | null | undefined = status.tracking;
      if (tracking && adapter.getTracking) {
        tracking = (await callSupplier((sig) => adapter.getTracking!(row.supplier_order_ref, sig), opts.retry, opts.sleep).catch(() => null)) ?? status.tracking;
      }
      await applySupplierStatus(db, row, { ...status, tracking: tracking ?? undefined });
      synced++;
    } catch (e) {
      errors++;
      const msg = e instanceof SupplierError || e instanceof Error ? e.message : String(e);
      const failures = row.sync_failures + 1;
      const delayMin = Math.min(24 * 60, 30 * 2 ** Math.min(failures - 1, 6));
      await db`update public.supplier_orders set sync_failures = ${failures}, next_sync_at = now() + make_interval(mins => ${delayMin}) where id = ${row.id}`;
      await logAutomation(db, { orderId: row.order_id, supplierOrderId: row.id, level: "warn", event: "sync.error", message: `${row.supplier_name}: ${msg}` });
      if (failures === 5) {
        await notify(db, { kind: "supplier_sync", severity: "warning", title: `Tracking sync keeps failing for ${row.supplier_name} order ${row.supplier_order_ref}`, body: msg.slice(0, 500), link: `/admin/orders/${row.order_id}`, dedupeKey: `sync-fail:${row.id}` });
      }
    }
  }
  return { synced, errors };
}

const EVENT_RANK: Record<SupplierTrackingEvent["status"], number> = { label_created: 0, in_transit: 1, out_for_delivery: 2, exception: 2, delivered: 3 };

/** Applies one supplier status reading. Exported for tests. */
export async function applySupplierStatus(db: Db, row: Pick<DueRow, "id" | "order_id" | "supplier_name" | "supplier_order_ref" | "supplier_payment_status" | "created_at">, st: SupplierOrderStatus): Promise<void> {
  await inTx(db, async (tx) => {
    const [o] = await tx<{ status: OrderStatus; order_number: number }[]>`select status, order_number from public.orders where id = ${row.order_id} for update`;
    if (!o) return;
    const log = (event: string, message: string, level: "info" | "warn" | "error" = "info", data?: unknown) =>
      logAutomation(tx, { orderId: row.order_id, supplierOrderId: row.id, event, message, level, data });

    const payment = st.paymentState === "paid" ? "paid" : st.paymentState === "failed" ? "failed" : st.paymentState === "pending" ? "pending" : null;
    const next = st.state === "delivered" ? null : st.state === "shipped" ? "6 hours" : "2 hours";
    await tx`update public.supplier_orders set supplier_status_raw = ${st.raw ?? st.state}, last_synced_at = now(), sync_failures = 0,
               supplier_payment_status = coalesce(${payment}, supplier_payment_status),
               next_sync_at = case when ${next}::text is null then null else now() + ${next ?? "2 hours"}::interval end
             where id = ${row.id}`;
    if (payment && payment !== row.supplier_payment_status) await log("sync.payment", `${row.supplier_name} payment: ${payment}`);
    if (payment === "failed") {
      await notify(tx, { kind: "supplier_payment", severity: "critical", title: `Supplier payment failed for order #${o.order_number}`, body: `${row.supplier_name} order ${row.supplier_order_ref}`, link: `/admin/orders/${row.order_id}`, dedupeKey: `supplier-pay-failed:${row.id}` });
    }
    if ((payment ?? row.supplier_payment_status) === "pending" && Date.now() - new Date(row.created_at).getTime() > 12 * 3600_000) {
      await notify(tx, { kind: "supplier_payment", severity: "warning", title: `Order #${o.order_number}: supplier order still unpaid`, body: `${row.supplier_name} order ${row.supplier_order_ref} — pay it in your supplier account or it may be cancelled.`, link: "/admin/dropshipping", dedupeKey: `supplier-unpaid:${row.id}:${new Date().toISOString().slice(0, 10)}` });
    }

    if (st.state === "rejected" || st.state === "cancelled") {
      await tx`update public.supplier_orders set status = 'failed', last_error = ${`Supplier reports the order ${st.state} (${st.raw ?? ""})`}, next_sync_at = null where id = ${row.id}`;
      await log("sync.cancelled", `${row.supplier_name} order ${row.supplier_order_ref} is ${st.state}`, "error");
      await notify(tx, { kind: "supplier_failed", severity: "critical", title: `Supplier cancelled order #${o.order_number}`, body: `${row.supplier_name} ${row.supplier_order_ref}: ${st.raw ?? st.state}. Use a backup supplier or refund the customer.`, link: `/admin/orders/${row.order_id}`, dedupeKey: `supplier-cancel:${row.id}` });
      if (o.status === "submitted_to_supplier") await transitionOrderInDb(tx, row.order_id, "failed", { type: SYNC }, { reason: `Supplier ${st.state} the order` });
      return;
    }
    if (st.state === "unknown") {
      await log("sync.unknown", `${row.supplier_name} status ${st.raw ?? "?"} needs a look`, "warn");
      await notify(tx, { kind: "supplier_sync", severity: "warning", title: `Order #${o.order_number}: unexpected supplier status ${st.raw ?? ""}`, link: `/admin/orders/${row.order_id}`, dedupeKey: `supplier-unknown:${row.id}:${st.raw ?? ""}` });
    }

    let status = o.status;
    // Supplier accepted: paid at the supplier (or, when the API does not report payment, already being processed).
    const accepted = payment === "paid" || (st.paymentState === undefined || st.paymentState === "unknown") && ["processing", "shipped", "delivered"].includes(st.state);
    if (status === "submitted_to_supplier" && accepted) {
      const [{ open } = { open: 0 }] = await tx<{ open: number }[]>`
        select count(*)::int as open from public.supplier_orders where order_id = ${row.order_id} and id <> ${row.id}
           and (status <> 'submitted' or supplier_payment_status in ('pending', 'failed'))`;
      if (open === 0) {
        await transitionOrderInDb(tx, row.order_id, "supplier_accepted", { type: SYNC }, { reason: `${row.supplier_name} accepted the order` });
        status = "supplier_accepted";
      }
    }

    const t = st.tracking;
    if (t?.trackingNumber && t.carrier) {
      await tx`insert into public.shipments (order_id, supplier_order_id, carrier, tracking_number, tracking_url, status, shipped_at)
               values (${row.order_id}, ${row.id}, ${t.carrier.slice(0, 120)}, ${t.trackingNumber.slice(0, 120)}, ${t.url ?? null}, 'in_transit', now())
               on conflict (carrier, tracking_number) do nothing`;
      const [sh] = await tx<{ id: string; status: string; order_id: string }[]>`select id, status, order_id from public.shipments where carrier = ${t.carrier.slice(0, 120)} and tracking_number = ${t.trackingNumber.slice(0, 120)}`;
      if (sh && sh.order_id === row.order_id) {
        for (const ev of t.events ?? []) {
          await tx`insert into public.tracking_events (shipment_id, status, description, location, occurred_at)
                   values (${sh.id}, ${ev.status}, ${ev.description.slice(0, 500)}, ${ev.location?.slice(0, 200) ?? null}, ${ev.occurredAt})
                   on conflict do nothing`;
        }
        const latest = [...(t.events ?? [])].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
        let shipStatus: string = latest?.status ?? "in_transit";
        if (st.state === "delivered") shipStatus = "delivered";
        if (shipStatus === "label_created") shipStatus = "in_transit"; // label only: still counts as handed over by the supplier
        if (sh.status !== "delivered" && (EVENT_RANK[shipStatus as SupplierTrackingEvent["status"]] >= EVENT_RANK[sh.status as SupplierTrackingEvent["status"]] || shipStatus === "exception" || sh.status === "exception")) {
          await tx`update public.shipments set status = ${shipStatus}, updated_at = now(), delivered_at = case when ${shipStatus} = 'delivered' then now() else delivered_at end where id = ${sh.id}`;
          if (shipStatus !== sh.status) await log("sync.tracking", `${t.carrier} ${t.trackingNumber}: ${shipStatus}`);
          if (shipStatus === "exception") {
            await notify(tx, { kind: "delivery_exception", severity: "warning", title: `Delivery problem on order #${o.order_number}`, body: latest?.description ?? "", link: `/admin/orders/${row.order_id}`, dedupeKey: `ship-exc:${sh.id}` });
          }
        }
        if (status === "supplier_accepted") {
          await transitionOrderInDb(tx, row.order_id, "shipped", { type: SYNC }, { reason: `Shipped by ${row.supplier_name}`, evidence: { trackingNumber: t.trackingNumber, carrier: t.carrier } });
          status = "shipped";
        }
        if (status === "shipped") {
          const [{ open } = { open: 1 }] = await tx<{ open: number }[]>`select count(*)::int as open from public.shipments where order_id = ${row.order_id} and status <> 'delivered'`;
          const [{ waiting } = { waiting: 1 }] = await tx<{ waiting: number }[]>`
            select count(*)::int as waiting from public.supplier_orders so where so.order_id = ${row.order_id}
               and not exists (select 1 from public.shipments s where s.supplier_order_id = so.id)`;
          if (open === 0 && waiting === 0) await transitionOrderInDb(tx, row.order_id, "delivered", { type: SYNC }, { reason: "All shipments delivered" });
        }
      }
    }
  });
}
