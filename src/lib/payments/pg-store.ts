/**
 * Postgres implementation of PaymentWebhookStore. Deduplication = UNIQUE (provider, provider_event_id)
 * on payment_events; order status changes go through `transitionOrderInDb` (state machine + inventory).
 * Runs inside the webhook route's transaction: any error rolls everything back and the provider retries.
 */
import type { Db } from "../db/client";
import { finalizeRefund, markRefundFailed, transitionOrderInDb } from "../admin/services/orders";
import { notify } from "../admin/services/notifications";
import type { CurrencyCode } from "../money";
import type { OrderStatus } from "../orders/state-machine";
import { recordPaymentFinancials } from "./financials";
import type { PaymentEvent } from "./types";
import type { PaymentWebhookStore } from "./webhook";

const isUuid = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

export function pgWebhookStore(db: Db, opts: { isTest: boolean }): PaymentWebhookStore {
  let current: { providerId: string; event: PaymentEvent } | null = null;
  return {
    async recordEventOnce(providerId, event) {
      const rows = await db`
        insert into public.payment_events (provider, provider_event_id, event_type, order_id, payload)
        values (${providerId}, ${event.eventId}, ${event.type}, ${isUuid(event.orderId) ? event.orderId : null},
                ${db.json(JSON.parse(JSON.stringify(event)))})
        on conflict (provider, provider_event_id) do nothing returning id`;
      current = { providerId, event };
      return rows.length === 1;
    },
    async getOrder(orderId) {
      if (!isUuid(orderId)) return null;
      // Row lock: concurrent deliveries of different events for the same order are serialised.
      const [o] = await db<{ id: string; status: OrderStatus; total: number; currency: CurrencyCode }[]>`
        select id, status, total, currency from public.orders where id = ${orderId} for update`;
      return o ? { id: o.id, status: o.status, total: { amount: Number(o.total), currency: o.currency } } : null;
    },
    async findOrderIdByProviderPayment(providerId, providerPaymentId) {
      const [p] = await db<{ order_id: string }[]>`select order_id from public.payments where provider = ${providerId} and provider_payment_id = ${providerPaymentId}`;
      return p?.order_id ?? null;
    },
    async applyTransition(orderId, audit) {
      const ev = current?.event;
      const providerId = current?.providerId ?? "unknown";
      if (audit.toStatus === "paid" && ev) await upsertSucceededPayment(db, orderId, providerId, ev, opts.isTest);
      if (audit.toStatus === "failed" || audit.toStatus === "cancelled") {
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
    async isCurrentSession(orderId, providerId, providerSessionId) {
      const [p] = await db<{ provider_session_id: string | null }[]>`
        select provider_session_id from public.payments where order_id = ${orderId} and provider = ${providerId} and status = 'pending'
         order by updated_at desc nulls last limit 1`;
      return p?.provider_session_id === providerSessionId;
    },
    async flagForReview(orderId, reason, dedupeKey) {
      await notify(db, {
        kind: "payment_review", severity: "critical", title: "Payment needs review", body: reason.slice(0, 500),
        link: isUuid(orderId) ? `/admin/orders/${orderId}` : "/admin/payments", dedupeKey,
      });
    },
    async recordUnmatchedPayment(orderId, providerId, event) {
      await upsertSucceededPayment(db, orderId, providerId, event, opts.isTest);
    },
    async recordPaymentFinancials(providerId, providerPaymentId, balance) {
      await recordPaymentFinancials(db, providerId, providerPaymentId, balance);
    },
    async applyRefundUpdate(providerId, event) {
      const info = event.refund;
      if (!info) return "unknown";
      const [local] = await db<{ id: string; status: string; amount: number; currency: CurrencyCode }[]>`
        select id, status, amount, currency from public.refunds
         where provider = ${providerId}
           and (provider_refund_id = ${info.providerRefundId}
                or (${isUuid(info.localRefundId) ? info.localRefundId : null}::uuid is not null and id = ${isUuid(info.localRefundId) ? info.localRefundId : null}::uuid
                    and (provider_refund_id is null or provider_refund_id = ${info.providerRefundId})))
         order by (provider_refund_id = ${info.providerRefundId}) desc nulls last limit 1
         for update`;
      if (!local) return "unknown";
      if (Number(local.amount) !== event.amount.amount || local.currency !== event.amount.currency) {
        await notify(db, { kind: "payment_review", severity: "critical", title: "Refund amount differs from the provider", body: `Refund ${info.providerRefundId}: provider ${event.amount.amount} ${event.amount.currency}, recorded ${local.amount} ${local.currency}`, dedupeKey: `refund-mismatch:${info.providerRefundId}` });
        return "unknown";
      }
      await db`update public.refunds set provider_refund_id = ${info.providerRefundId} where id = ${local.id} and provider_refund_id is null`;
      if (info.status === "pending") return "pending";
      if (info.status === "succeeded") return (await finalizeRefund(db, local.id, "succeeded", info.providerRefundId)) ? "finalized" : "already_settled";
      // failed / canceled
      if (local.status === "pending") {
        await markRefundFailed(db, local.id, `Provider reported the refund as ${info.status}`);
        return "failed";
      }
      if (local.status === "succeeded") {
        await notify(db, { kind: "payment_review", severity: "critical", title: "A completed refund later failed at the provider", body: `Refund ${info.providerRefundId} is now ${info.status}. Contact the customer.`, dedupeKey: `refund-reversed:${info.providerRefundId}` });
      }
      return "already_settled";
    },
  };
}

async function upsertSucceededPayment(db: Db, orderId: string, providerId: string, ev: PaymentEvent, isTest: boolean) {
  const updated = await db`update public.payments set status = 'succeeded', provider_payment_id = ${ev.providerPaymentId}
                            where order_id = ${orderId} and provider = ${providerId} and status = 'pending' returning id`;
  if (!updated.length) {
    await db`insert into public.payments (order_id, provider, provider_payment_id, status, amount, currency, is_test)
             values (${orderId}, ${providerId}, ${ev.providerPaymentId}, 'succeeded', ${ev.amount.amount}, ${ev.amount.currency}, ${isTest})
             on conflict (provider, provider_payment_id) do nothing`;
  }
}
