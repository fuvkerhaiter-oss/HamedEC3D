/**
 * Payment webhooks for shop rentals. Called from the shared webhook pipeline (lib/payments/webhook.ts) after the
 * signature check and dedupe, inside the same transaction. Same rules as orders: a lease is paid only after the
 * provider's own records confirm the payment and the amount matches what the server priced.
 */
import type { Db } from "../db/client";
import { notify } from "../admin/services/notifications";
import type { PaymentEvent, PaymentProvider } from "../payments/types";
import type { WebhookResult } from "../payments/webhook";
import { activateLease, LEASE_REF_PREFIX, type LeaseRow } from "./service";

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** The lease an event belongs to (by our reference, or by the provider payment id for refunds/disputes). */
export function leaseIdFromEvent(event: Pick<PaymentEvent, "orderId">): string | null {
  const ref = event.orderId;
  if (!ref?.startsWith(LEASE_REF_PREFIX)) return null;
  const id = ref.slice(LEASE_REF_PREFIX.length);
  return isUuid(id) ? id : null;
}

export async function handleRentalPaymentEvent(db: Db, provider: PaymentProvider, event: PaymentEvent): Promise<WebhookResult | null> {
  let id = leaseIdFromEvent(event);
  if (!id && event.orderId?.startsWith(LEASE_REF_PREFIX)) return { status: "ignored", reason: "Malformed rental reference" };
  if (!id && event.providerPaymentId) {
    const [m] = await db<{ id: string }[]>`select id from public.shop_leases where provider = ${provider.id} and provider_payment_id = ${event.providerPaymentId}`;
    id = m?.id ?? null;
  }
  if (!id) return null; // not a rental: the order pipeline handles it

  const [l] = await db<LeaseRow[]>`select * from public.shop_leases where id = ${id} for update`;
  const done = (leaseStatus: string, changed: boolean): WebhookResult => ({ status: "rental", leaseId: id!, leaseStatus, changed });
  const review = (title: string, body: string, key: string) =>
    notify(db, { kind: "rental_review", severity: "critical", title, body: body.slice(0, 900), link: "/admin/rentals", dedupeKey: key });

  if (!l) {
    if (event.type === "payment.succeeded") await review("Rental payment without a booking", `Payment ${event.providerPaymentId} at ${provider.id} refers to an unknown rental.`, `rental-unknown:${event.providerPaymentId}`);
    return { status: "ignored", reason: "Unknown rental" };
  }

  switch (event.type) {
    case "payment.succeeded": {
      const verified = provider.retrievePayment ? await provider.retrievePayment(event.providerPaymentId) : null;
      if (verified?.status === "pending") throw new Error(`Payment ${event.providerPaymentId} is not settled yet at ${provider.id}`); // provider retries
      if (verified && verified.status !== "succeeded") {
        await review(`Rental ${l.reference}: payment not confirmed`, `The webhook said paid but ${provider.id} reports ${verified.status}.`, `rental-state:${event.providerPaymentId}`);
        return { status: "ignored", reason: `Provider reports the payment as ${verified.status}` };
      }
      const got = verified?.amountReceived ?? event.amount;
      if (got.amount !== event.amount.amount || got.currency !== event.amount.currency || got.amount !== l.amount || got.currency !== l.currency) {
        await db`update public.shop_leases set status = 'payment_review', provider_payment_id = ${event.providerPaymentId}, paid_at = coalesce(paid_at, now()), updated_at = now()
                 where id = ${l.id} and status in ('pending_payment', 'expired_unpaid', 'cancelled')`;
        await review(`Rental ${l.reference}: paid amount differs`, `Received ${got.amount} ${got.currency}, booking is ${l.amount} ${l.currency}. Check it at ${provider.id}.`, `rental-mismatch:${event.providerPaymentId}`);
        return done("payment_review", true);
      }
      if (l.status === "active" || l.status === "payment_review" || l.status === "refunded") return done(l.status, false);
      // pending_payment, or released meanwhile (expired/cancelled): money was taken, so try to give them the shop.
      const ok = await activateLease(db, l, event.providerPaymentId);
      return done(ok ? "active" : "payment_review", true);
    }
    case "payment.expired":
    case "payment.failed": {
      if (l.status !== "pending_payment") return done(l.status, false);
      if (event.providerSessionId && l.provider_session_id && event.providerSessionId !== l.provider_session_id) return done(l.status, false);
      await db`update public.shop_leases set status = 'expired_unpaid', cancel_reason = ${event.type === "payment.failed" ? "Payment failed" : "Payment page expired"},
                 cancelled_at = now(), updated_at = now() where id = ${l.id}`;
      return done("expired_unpaid", true);
    }
    case "payment.disputed": {
      const d = event.dispute;
      await review(`Chargeback on shop rental ${l.reference}`, `${l.brand_name}: dispute ${d?.id ?? ""} is ${d?.status ?? "open"} (${d?.reason ?? "no reason"}). Respond in ${provider.id}.`, `rental-dispute:${d?.id}:${d?.status}`);
      return done(l.status, false);
    }
    case "refund.updated":
    case "refund.succeeded": {
      // Refunds sent from the admin already updated the lease; anything else was done directly at the provider.
      if (l.refunded_amount === 0 && (event.type === "refund.succeeded" || event.refund?.status === "succeeded")) {
        await review(`Rental ${l.reference} refunded outside the admin`, `A refund was made at ${provider.id} for ${l.brand_name}. Cancel the rental in the admin if the shop should be released.`, `rental-refund-outside:${event.eventId}`);
      }
      return done(l.status, false);
    }
    default:
      return done(l.status, false); // payment.attempt_failed: the tenant can retry on the same payment page
  }
}
