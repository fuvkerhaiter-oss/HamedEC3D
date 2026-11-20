/**
 * Postgres implementation of PaymentWebhookStore. Deduplication = UNIQUE (provider, provider_event_id)
 * on payment_events; order status changes go through `transitionOrderInDb` (state machine + inventory).
 */
import type { Db } from "../db/client";
import { finalizeRefund, transitionOrderInDb } from "../admin/services/orders";
import type { CurrencyCode } from "../money";
import type { OrderStatus } from "../orders/state-machine";
import type { PaymentEvent } from "./types";
import type { PaymentWebhookStore } from "./webhook";

export function pgWebhookStore(db: Db, opts: { isTest: boolean }): PaymentWebhookStore {
  let current: { providerId: string; event: PaymentEvent } | null = null;
  return {
    async recordEventOnce(providerId, event) {
      const rows = await db`
        insert into public.payment_events (provider, provider_event_id, event_type, order_id, payload)
        values (${providerId}, ${event.eventId}, ${event.type}, ${event.orderId && /^[0-9a-f-]{36}$/i.test(event.orderId) ? event.orderId : null},
                ${db.json(JSON.parse(JSON.stringify(event)))})
        on conflict (provider, provider_event_id) do nothing returning id`;
      current = { providerId, event };
      return rows.length === 1;
    },
    async getOrder(orderId) {
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
      const [o] = await db<{ id: string; status: OrderStatus; total: number; currency: CurrencyCode }[]>`select id, status, total, currency from public.orders where id = ${orderId}`;
      return o ? { id: o.id, status: o.status, total: { amount: o.total, currency: o.currency } } : null;
    },
    async findOrderIdByProviderPayment(providerId, providerPaymentId) {
      const [p] = await db<{ order_id: string }[]>`select order_id from public.payments where provider = ${providerId} and provider_payment_id = ${providerPaymentId}`;
      return p?.order_id ?? null;
    },
    async applyTransition(orderId, audit) {
      const ev = current?.event;
      const providerId = current?.providerId ?? "unknown";
      if (audit.toStatus === "paid" && ev) {
        const updated = await db`update public.payments set status = 'succeeded', provider_payment_id = ${ev.providerPaymentId}
                                  where order_id = ${orderId} and provider = ${providerId} and status = 'pending' returning id`;
        if (!updated.length) {
          await db`insert into public.payments (order_id, provider, provider_payment_id, status, amount, currency, is_test)
                   values (${orderId}, ${providerId}, ${ev.providerPaymentId}, 'succeeded', ${ev.amount.amount}, ${ev.amount.currency}, ${opts.isTest})
                   on conflict (provider, provider_payment_id) do nothing`;
        }
      }
      if (audit.toStatus === "failed") {
        await db`update public.payments set status = 'failed' where order_id = ${orderId} and provider = ${providerId} and status = 'pending'`;
      }
      if (audit.toStatus === "refunded") {
        // Confirm pending refunds for this order, which completes the order via finalizeRefund.
        const pending = await db<{ id: string }[]>`select id from public.refunds where order_id = ${orderId} and status = 'pending'`;
        for (const r of pending) await finalizeRefund(db, r.id, "succeeded", null);
        const [o] = await db<{ status: OrderStatus }[]>`select status from public.orders where id = ${orderId}`;
        if (o?.status !== "refund_requested") return;
      }
      await transitionOrderInDb(db, orderId, audit.toStatus, { type: audit.actorType, id: audit.actorId ?? undefined }, {
        reason: audit.reason ?? undefined, evidence: audit.evidence,
      });
    },
  };
}
