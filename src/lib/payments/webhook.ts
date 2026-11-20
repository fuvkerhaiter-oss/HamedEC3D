/**
 * Provider-agnostic webhook processing: verify → deduplicate → validate amount → transition order.
 */
import { transitionOrder, type OrderAuditEntry, type OrderStatus } from "../orders/state-machine";
import type { Money } from "../money";
import type { PaymentEvent, PaymentProvider } from "./types";

export interface PaymentWebhookStore {
  /** Atomically record the event id; returns false if already processed (UNIQUE on payment_events.provider_event_id). */
  recordEventOnce(providerId: string, event: PaymentEvent): Promise<boolean>;
  getOrder(orderId: string): Promise<{ id: string; status: OrderStatus; total: Money } | null>;
  findOrderIdByProviderPayment(providerId: string, providerPaymentId: string): Promise<string | null>;
  applyTransition(orderId: string, audit: OrderAuditEntry): Promise<void>;
}

export type WebhookResult =
  | { status: "processed"; orderStatus: OrderStatus }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

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

  const orderId = event.orderId ?? (await store.findOrderIdByProviderPayment(provider.id, event.providerPaymentId));
  const order = orderId ? await store.getOrder(orderId) : null;
  if (!order) return { status: "ignored", reason: "Unknown order" };

  if (event.type === "payment.succeeded") {
    if (event.amount.currency !== order.total.currency || event.amount.amount !== order.total.amount) {
      return { status: "ignored", reason: "Paid amount does not match order total — flagged for review" };
    }
    if (order.status !== "pending_payment") return { status: "ignored", reason: `Order already ${order.status}` };
    const audit = transitionOrder({
      from: order.status,
      to: "paid",
      actor: { type: "payment_webhook", id: provider.id },
      evidence: { verifiedPaymentId: event.providerPaymentId },
    });
    await store.applyTransition(order.id, audit);
    return { status: "processed", orderStatus: "paid" };
  }

  if (event.type === "payment.failed") {
    if (order.status !== "pending_payment") return { status: "ignored", reason: `Order already ${order.status}` };
    const audit = transitionOrder({ from: order.status, to: "failed", actor: { type: "payment_webhook", id: provider.id }, reason: "Payment failed" });
    await store.applyTransition(order.id, audit);
    return { status: "processed", orderStatus: "failed" };
  }

  // refund.succeeded
  if (order.status !== "refund_requested") return { status: "ignored", reason: `Refund event while order is ${order.status}` };
  const audit = transitionOrder({ from: order.status, to: "refunded", actor: { type: "payment_webhook", id: provider.id } });
  await store.applyTransition(order.id, audit);
  return { status: "processed", orderStatus: "refunded" };
}
