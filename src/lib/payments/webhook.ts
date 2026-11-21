/**
 * Provider-agnostic webhook processing: verify signature → deduplicate → independently re-verify the payment
 * with the provider (when it has a server-side lookup) → validate amount → transition order.
 * Any thrown error rolls back the whole transaction (including the dedupe record), so the provider retries;
 * nothing is marked paid unless every check passed.
 */
import { transitionOrder, type OrderAuditEntry, type OrderStatus } from "../orders/state-machine";
import type { Money } from "../money";
import type { BalanceFigures, PaymentEvent, PaymentProvider } from "./types";

export type RefundUpdateOutcome = "finalized" | "failed" | "pending" | "already_settled" | "unknown";

export interface PaymentWebhookStore {
  /** Atomically record the event id; returns false if already processed (UNIQUE on payment_events.provider_event_id). */
  recordEventOnce(providerId: string, event: PaymentEvent): Promise<boolean>;
  /** Implementations should lock the order row (SELECT … FOR UPDATE) for the rest of the transaction. */
  getOrder(orderId: string): Promise<{ id: string; status: OrderStatus; total: Money } | null>;
  findOrderIdByProviderPayment(providerId: string, providerPaymentId: string): Promise<string | null>;
  applyTransition(orderId: string, audit: OrderAuditEntry): Promise<void>;
  /** Alert an admin (critical) about money that needs a human decision. */
  flagForReview(orderId: string | null, reason: string, dedupeKey: string): Promise<void>;
  /** Payment captured for an order that can no longer be paid (expired/cancelled): keep the record so it can be refunded. */
  recordUnmatchedPayment(orderId: string, providerId: string, event: PaymentEvent): Promise<void>;
  recordPaymentFinancials(providerId: string, providerPaymentId: string, balance: BalanceFigures): Promise<void>;
  applyRefundUpdate(providerId: string, event: PaymentEvent): Promise<RefundUpdateOutcome>;
}

export type WebhookResult =
  | { status: "processed"; orderStatus: OrderStatus }
  | { status: "refund"; outcome: RefundUpdateOutcome }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

const sameMoney = (a: Money, b: Money) => a.amount === b.amount && a.currency === b.currency;

export async function handlePaymentWebhook(
  provider: PaymentProvider,
  rawBody: string,
  headers: Headers,
  store: PaymentWebhookStore,
): Promise<WebhookResult> {
  // Throws WebhookVerificationError → route returns 400.
  const event = await provider.verifyWebhook(rawBody, headers);
  if (!event) return { status: "ignored", reason: "Event type not handled" };

  const fresh = await store.recordEventOnce(provider.id, event);
  if (!fresh) return { status: "duplicate" };

  if (event.type === "refund.updated") {
    const outcome = await store.applyRefundUpdate(provider.id, event);
    if (outcome === "unknown") {
      await store.flagForReview(event.orderId, `Refund ${event.refund?.providerRefundId ?? "?"} (${event.refund?.status}) was made outside the admin — check it at ${provider.id}`, `refund-unknown:${event.refund?.providerRefundId}`);
    }
    return { status: "refund", outcome };
  }

  const orderId = event.orderId ?? (await store.findOrderIdByProviderPayment(provider.id, event.providerPaymentId));
  const order = orderId ? await store.getOrder(orderId) : null;
  if (!order) {
    if (event.type === "payment.succeeded") await store.flagForReview(null, `Payment ${event.providerPaymentId} does not match any order`, `pay-unknown:${event.providerPaymentId}`);
    return { status: "ignored", reason: "Unknown order" };
  }

  if (event.type === "payment.succeeded") {
    // Independent server-side verification with the provider's own records (Stripe PaymentIntent).
    // Network/API errors throw → 500 → the provider retries; the order is NOT marked paid meanwhile.
    const verified = provider.retrievePayment ? await provider.retrievePayment(event.providerPaymentId) : null;
    if (verified?.status === "pending") {
      // Not settled yet at the provider: fail this delivery so it is retried later (nothing is marked paid).
      throw new Error(`Payment ${event.providerPaymentId} is not settled yet at ${provider.id}`);
    }
    if (verified && verified.status !== "succeeded") {
      await store.flagForReview(order.id, `Webhook said paid but ${provider.id} reports the payment as ${verified.status}`, `pay-state:${event.providerPaymentId}`);
      return { status: "ignored", reason: `Provider reports the payment as ${verified.status}` };
    }
    if (verified && !sameMoney(verified.amountReceived, event.amount)) {
      await store.flagForReview(order.id, `Provider received ${verified.amountReceived.amount} ${verified.amountReceived.currency} but the event says ${event.amount.amount} ${event.amount.currency}`, `pay-mismatch:${event.providerPaymentId}`);
      return { status: "ignored", reason: "Provider record does not match the event — flagged for review" };
    }
    if (!sameMoney(event.amount, order.total)) {
      await store.flagForReview(order.id, `Paid ${event.amount.amount} ${event.amount.currency} but the order total is ${order.total.amount} ${order.total.currency}`, `pay-mismatch:${event.providerPaymentId}`);
      return { status: "ignored", reason: "Paid amount does not match order total — flagged for review" };
    }
    if (order.status !== "pending_payment") {
      if (order.status !== "paid") {
        // e.g. the checkout expired and was cancelled, then the customer paid: money was taken, an admin must refund or reinstate.
        await store.recordUnmatchedPayment(order.id, provider.id, event);
        await store.flagForReview(order.id, `Payment received for an order that is ${order.status} — refund the customer or contact them`, `pay-late:${event.providerPaymentId}`);
      }
      return { status: "ignored", reason: `Order already ${order.status}` };
    }
    const audit = transitionOrder({
      from: order.status,
      to: "paid",
      actor: { type: "payment_webhook", id: provider.id },
      evidence: { verifiedPaymentId: event.providerPaymentId },
    });
    await store.applyTransition(order.id, audit);
    if (verified?.balance) await store.recordPaymentFinancials(provider.id, event.providerPaymentId, verified.balance);
    return { status: "processed", orderStatus: "paid" };
  }

  if (event.type === "payment.failed") {
    if (order.status !== "pending_payment") return { status: "ignored", reason: `Order already ${order.status}` };
    const audit = transitionOrder({ from: order.status, to: "failed", actor: { type: "payment_webhook", id: provider.id }, reason: "Payment failed" });
    await store.applyTransition(order.id, audit);
    return { status: "processed", orderStatus: "failed" };
  }

  // refund.succeeded (the charge is now fully refunded)
  if (order.status === "refunded") return { status: "ignored", reason: "Order already refunded" };
  if (order.status !== "refund_requested") {
    await store.flagForReview(order.id, `The payment was fully refunded at ${provider.id} while the order is ${order.status} — record the refund in the admin`, `refund-outside:${event.eventId}`);
    return { status: "ignored", reason: `Refund event while order is ${order.status}` };
  }
  const audit = transitionOrder({ from: order.status, to: "refunded", actor: { type: "payment_webhook", id: provider.id } });
  await store.applyTransition(order.id, audit);
  return { status: "processed", orderStatus: "refunded" };
}
